//! State structures for the Nova Staking program.
//!
//! This module defines all account structures used to store program state.

pub mod stake_pool;
pub mod user_stake;

pub use stake_pool::*;
pub use user_stake::*;
