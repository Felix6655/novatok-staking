//! User Stake state structure.
//!
//! The UserStake account stores individual user staking information.
//!
//! ## Security Invariants
//! - `owner` is set once and must match signer for unstake/claim
//! - `stake_pool` links this stake to a specific pool
//! - `tier` cannot be changed while stake is active
//! - Lock periods enforced based on tier

use anchor_lang::prelude::*;
use crate::constants::{CORE_LOCK_PERIOD, FLEX_LOCK_PERIOD, PRIME_LOCK_PERIOD};

/// Individual user staking account.
///
/// This account is a PDA derived from USER_STAKE_SEED, pool pubkey, and user pubkey.
/// It stores the user's staked amount, tier, and reward tracking information.
///
/// ## Account Size: 149 bytes (including 8-byte discriminator)
#[account]
#[derive(Default)]
pub struct UserStake {
    /// The owner of this stake account.
    /// SECURITY: Must match signer for unstake/claim operations.
    pub owner: Pubkey,

    /// The stake pool this stake belongs to.
    /// SECURITY: Validated on every instruction to prevent cross-pool attacks.
    pub stake_pool: Pubkey,

    /// Amount of tokens currently staked.
    pub staked_amount: u64,

    /// Staking tier (0=Flex, 1=Core, 2=Prime).
    /// SECURITY: Cannot be changed while staked_amount > 0.
    pub tier: u8,

    /// Timestamp when staking started (for lock period calculation).
    /// SECURITY: Used to enforce lock periods for Core/Prime.
    pub stake_start_time: i64,

    /// Timestamp of last reward claim/update.
    /// SECURITY: Used for linear reward calculation.
    pub last_claim_time: i64,

    /// Total rewards claimed by this user.
    pub total_rewards_claimed: u64,

    /// Pending rewards not yet claimed.
    /// SECURITY: Accumulated during stake operations, reset on claim.
    pub pending_rewards: u64,

    /// Whether this stake is currently active.
    pub is_active: bool,

    /// Bump seed for PDA derivation.
    /// SECURITY: Used to verify PDA in instructions.
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
    /// - Flex (0): 0 (no lock)
    /// - Core (1): 90 days = 7,776,000 seconds
    /// - Prime (2): 180 days = 15,552,000 seconds
    /// - Invalid: 0 (defensive)
    pub fn get_lock_period(&self) -> i64 {
        match self.tier {
            0 => FLEX_LOCK_PERIOD,
            1 => CORE_LOCK_PERIOD,
            2 => PRIME_LOCK_PERIOD,
            _ => 0, // Invalid tier has no lock (but should never happen)
        }
    }

    /// Check if the lock period has ended.
    ///
    /// # Security
    /// - Uses saturating_add to prevent overflow
    /// - Flex tier always returns true (no lock)
    ///
    /// # Arguments
    /// * `current_time` - Current Unix timestamp
    ///
    /// # Returns
    /// True if lock period has ended or if tier has no lock period.
    pub fn is_lock_ended(&self, current_time: i64) -> bool {
        let lock_period = self.get_lock_period();
        
        // Flex tier (lock_period == 0) can always unstake
        if lock_period == 0 {
            return true;
        }
        
        // Use saturating add to prevent overflow
        let lock_end = self.stake_start_time.saturating_add(lock_period);
        current_time >= lock_end
    }

    /// Calculate the lock end timestamp.
    ///
    /// # Returns
    /// Unix timestamp when the lock period ends.
    /// For Flex tier, returns stake_start_time (immediate unlock).
    pub fn lock_end_time(&self) -> i64 {
        self.stake_start_time.saturating_add(self.get_lock_period())
    }

    /// Get remaining lock time in seconds.
    ///
    /// # Arguments
    /// * `current_time` - Current Unix timestamp
    ///
    /// # Returns
    /// Seconds remaining until unlock, or 0 if already unlocked.
    pub fn remaining_lock_time(&self, current_time: i64) -> i64 {
        let lock_end = self.lock_end_time();
        if current_time >= lock_end {
            0
        } else {
            lock_end.saturating_sub(current_time)
        }
    }
}
