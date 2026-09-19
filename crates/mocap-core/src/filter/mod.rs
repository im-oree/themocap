//! Smoothing filters.
//!
//! [`one_euro`] is the scalar 1D filter; [`multi_joint`] fans it out across every
//! channel of a pose so a whole frame is smoothed with one call and one set of
//! shared parameters.

pub mod multi_joint;
pub mod one_euro;
