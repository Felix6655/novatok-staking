//! User Stake state structure.
//!
//! The UserStake account stores individual user staking information.

use anchor_lang::prelude::*;
use crate::constants::{CORE_LOCK_PERIOD, FLEX_LOCK_PERIOD, PRIME_LOCK_PERIOD};

/// Individual user staking account.
///
/// This account is a PDA derived from USER_STAKE_SEED, pool pubkey, and user pubkey.
/// It stores the user's staked amount, tier, and reward tracking information.
#[account]
#[derive(Default)]
pub struct UserStake {
    /// The owner of this stake account.
    pub owner: Pubkey,

    /// The stake pool this stake belongs to.
    pub stake_pool: Pubkey,

    /// Amount of tokens currently staked.
    pub staked_amount: u64,

    /// Staking tier (0=Flex, 1=Core, 2=Prime).
    pub tier: u8,

    /// Timestamp when staking started (for lock period calculation).
    pub stake_start_time: i64,

    /// Timestamp of last reward claim/update.
    pub last_claim_time: i64,

    /// Total rewards claimed by this user.
    pub total_rewards_claimed: u64,

    /// Pending rewards not yet claimed.
    pub pending_rewards: u64,

    /// Whether this stake is currently active.
    pub is_active: bool,

    /// Bump seed for PDA derivation.
    pub bump: u8,

    /// Reserved space for future upgrades.
    pub _reserved: [u8; 32],
}

impl UserStake {
    /// Calculate the space needed for the UserStake account.
    pub const LEN: usize = 8 +  // discriminator
        32 +  // owner
        32 +  // stake_pool
        8 +   // staked_amount
        1 +   // tier
        8 +   // stake_start_time
        8 +   // last_claim_time
        8 +   // total_rewards_claimed
        8 +   // pending_rewards
        1 +   // is_active
        1 +   // bump
        32;   // reserved

    /// Get the lock period in seconds for this stake's tier.
    ///
    /// # Returns
    /// Lock period in seconds:
    /// - Flex: 0 (no lock)
    /// - Core: 90 days
    /// - Prime: 180 days
    pub fn get_lock_period(&self) -> i64 {
        match self.tier {
            0 => FLEX_LOCK_PERIOD,
            1 => CORE_LOCK_PERIOD,
            2 => PRIME_LOCK_PERIOD,
            _ => 0,
        }
    }

    /// Check if the lock period has ended.
    ///
    /// # Arguments
    /// * `current_time` - Current Unix timestamp
    ///
    /// # Returns
    /// True if lock period has ended or if tier has no lock period.
    pub fn is_lock_ended(&self, current_time: i64) -> bool {
        let lock_period = self.get_lock_period();
        if lock_period == 0 {
            return true; // Flex tier has no lock
        }
        current_time >= self.stake_start_time.saturating_add(lock_period)
    }

    /// Calculate the lock end timestamp.
    ///
    /// # Returns
    /// Unix timestamp when the lock period ends.
    pub fn lock_end_time(&self) -> i64 {
        self.stake_start_time.saturating_add(self.get_lock_period())
    }
}
