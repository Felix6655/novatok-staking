use anchor_lang::prelude::*;

#[account]
pub struct UserStake {
    pub owner: Pubkey,
    pub stake_pool: Pubkey,

    pub staked_amount: u64,
    pub pending_rewards: u64,
    pub total_rewards_claimed: u64,

    pub stake_start_time: i64,
    pub last_claim_time: i64,

    pub tier: u8,
    pub is_active: bool,
    pub bump: u8,
}

impl UserStake {
    pub const LEN: usize = 8 + 32 + 32 + 8 + 8 + 8 + 8 + 8 + 1 + 1 + 1;

    pub fn is_lock_ended(&self, now: i64, lock_seconds: i64) -> bool {
        now.saturating_sub(self.stake_start_time) >= lock_seconds
    }
}
