#!/usr/bin/env python3
"""
Builds a *structurally real* ONNX file with MoveNet SinglePose Lightning's exact
signature, for use when the genuine weights cannot be obtained.

Why this exists
---------------
The build agent has no route to any model host (see docs/decisions.md > "Model
acquisition"). Rather than block, we author a real ONNX graph with the same I/O
contract as the real model and develop the entire pipeline against it:

    input   "input"     uint8    [1, 192, 192, 3]   (NHWC, no normalisation)
    output  "output_0"  float32  [1, 1, 17, 3]      (y, x, score) -- Y FIRST

Everything downstream of `session.run()` -- tensor binding, the worker protocol,
letterboxing, decoding, ring-buffer writes, the WMOC writer -- is exercised for
real. Only the learned weights are absent, so swapping in the genuine file is a
manifest change with no code change.

What it is NOT
--------------
This does not estimate pose. It computes a deterministic, *input-dependent*
synthetic skeleton so the output is not a frozen constant: a constant would let
a whole class of bugs through (a stuck frame index, a ring buffer that never
advances, a decoder reading the wrong offsets would all still "look fine").
Instead the pose sways with the image's mean brightness, so moving in front of
the camera visibly moves the skeleton -- wrong anatomically, but alive, which is
what makes plumbing faults obvious.

The file is emitted with `producer_name="themocap-stub"` so it can never be
confused with the real model, and the loader refuses it unless explicitly
allowed.

Usage:
    python3 tools/models/make_stub_movenet.py apps/web/public/models/
"""

from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

import numpy as np
import onnx
from onnx import TensorProto, helper, numpy_helper

INPUT_SIZE = 192
NUM_KEYPOINTS = 17
PRODUCER = "themocap-stub"

# A plausible standing pose in normalised (y, x) image coordinates, COCO-17
# order. Used as the base that the synthetic motion perturbs.
BASE_POSE = [
    (0.10, 0.50),  # nose
    (0.08, 0.47),  # left_eye
    (0.08, 0.53),  # right_eye
    (0.09, 0.44),  # left_ear
    (0.09, 0.56),  # right_ear
    (0.22, 0.40),  # left_shoulder
    (0.22, 0.60),  # right_shoulder
    (0.37, 0.36),  # left_elbow
    (0.37, 0.64),  # right_elbow
    (0.50, 0.33),  # left_wrist
    (0.50, 0.67),  # right_wrist
    (0.52, 0.44),  # left_hip
    (0.52, 0.56),  # right_hip
    (0.72, 0.43),  # left_knee
    (0.72, 0.57),  # right_knee
    (0.92, 0.42),  # left_ankle
    (0.92, 0.58),  # right_ankle
]

# How strongly each joint responds to the brightness signal. Extremities sway
# most, the head and hips barely move -- roughly how a real body behaves, so the
# result reads as a person rather than a uniformly wobbling point cloud.
SWAY = [
    0.02, 0.02, 0.02, 0.02, 0.02,  # head
    0.03, 0.03,                     # shoulders
    0.10, 0.10,                     # elbows
    0.16, 0.16,                     # wrists
    0.02, 0.02,                     # hips
    0.05, 0.05,                     # knees
    0.03, 0.03,                     # ankles
]


def build_graph() -> onnx.ModelProto:
    """
    Assembles the graph.

    Shape of the computation:

        signal = mean(input) / 255          -> scalar in 0..1
        phase  = (signal - 0.5) * 2         -> -1..1, centred
        x      = base_x + phase * sway
        y      = base_y + phase * sway * 0.5
        score  = 0.85 constant

    Everything is standard ONNX ops so it loads on any runtime/backend, and it
    genuinely reads the input tensor -- a graph that ignored its input would be
    optimised down to a constant by the runtime and defeat the purpose.
    """
    inp = helper.make_tensor_value_info(
        "input", TensorProto.UINT8, [1, INPUT_SIZE, INPUT_SIZE, 3]
    )
    out = helper.make_tensor_value_info(
        "output_0", TensorProto.FLOAT, [1, 1, NUM_KEYPOINTS, 3]
    )

    base_yx = np.array(BASE_POSE, dtype=np.float32)          # [17, 2] as (y, x)
    sway = np.array(SWAY, dtype=np.float32).reshape(NUM_KEYPOINTS, 1)
    # Y sways half as much as X: a person sways side to side more than up/down.
    sway_yx = np.concatenate([sway * 0.5, sway], axis=1)      # [17, 2]

    initializers = [
        numpy_helper.from_array(base_yx.reshape(1, 1, NUM_KEYPOINTS, 2), "base_yx"),
        numpy_helper.from_array(sway_yx.reshape(1, 1, NUM_KEYPOINTS, 2), "sway_yx"),
        numpy_helper.from_array(np.array(255.0, dtype=np.float32), "byte_max"),
        numpy_helper.from_array(np.array(0.5, dtype=np.float32), "half"),
        numpy_helper.from_array(np.array(2.0, dtype=np.float32), "two"),
        numpy_helper.from_array(
            np.full((1, 1, NUM_KEYPOINTS, 1), 0.85, dtype=np.float32), "scores"
        ),
    ]

    nodes = [
        helper.make_node("Cast", ["input"], ["as_float"], to=TensorProto.FLOAT),
        # Global mean over every axis -> a single scalar driving the animation.
        helper.make_node("ReduceMean", ["as_float"], ["mean_raw"], keepdims=0),
        helper.make_node("Div", ["mean_raw", "byte_max"], ["signal"]),
        helper.make_node("Sub", ["signal", "half"], ["centred"]),
        helper.make_node("Mul", ["centred", "two"], ["phase"]),
        helper.make_node("Mul", ["sway_yx", "phase"], ["offset"]),
        helper.make_node("Add", ["base_yx", "offset"], ["yx_raw"]),
        # Keep coordinates inside the frame even at extreme brightness.
        helper.make_node(
            "Clip", ["yx_raw", "zero_f", "one_f"], ["yx"]
        ),
        helper.make_node("Concat", ["yx", "scores"], ["output_0"], axis=3),
    ]

    initializers.append(numpy_helper.from_array(np.array(0.0, dtype=np.float32), "zero_f"))
    initializers.append(numpy_helper.from_array(np.array(1.0, dtype=np.float32), "one_f"))

    graph = helper.make_graph(
        nodes,
        "movenet_singlepose_lightning_stub",
        [inp],
        [out],
        initializer=initializers,
    )

    model = helper.make_model(
        graph,
        producer_name=PRODUCER,
        # opset 13 is old enough for broad runtime support and new enough for
        # ReduceMean's keepdims behaviour to be stable.
        opset_imports=[helper.make_operatorsetid("", 13)],
    )
    model.doc_string = (
        "SYNTHETIC placeholder with MoveNet SinglePose Lightning's I/O signature. "
        "Produces a deterministic input-dependent skeleton, NOT a pose estimate. "
        "Replace with the real Apache-2.0 model from "
        "https://huggingface.co/Xenova/movenet-singlepose-lightning"
    )
    model.ir_version = 9
    onnx.checker.check_model(model)
    return model


def main() -> int:
    out_dir = Path(sys.argv[1] if len(sys.argv) > 1 else "apps/web/public/models")
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / "movenet-singlepose-lightning.stub.onnx"

    model = build_graph()
    path.write_bytes(model.SerializeToString())

    data = path.read_bytes()
    digest = hashlib.sha256(data).hexdigest()

    print(f"wrote {path} ({len(data):,} bytes)")
    print(f"sha256 {digest}")
    print(
        json.dumps(
            {"file": f"/models/{path.name}", "sha256": digest, "sizeBytes": len(data)},
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
