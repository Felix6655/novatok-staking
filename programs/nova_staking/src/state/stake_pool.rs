use anchor_lang::prelude::*;

#[account]
pub struct StakePool {
    pub authority: Pubkey,
    pub staking_mint: Pubkey,
    pub staking_vault: Pubkey,
    pub treasury_vault: Pubkey,

    pub flex_apy: u16,
    pub core_apy: u16,
    pub prime_apy: u16,

    pub emission_cap: u64,
    pub total_distributed: u64,
    pub total_staked: u64,
    pub staker_count: u64,

    pub paused: bool,

    pub last_updated: i64,
    pub created_at: i64,

    pub vault_bump: u8,
    pub treasury_bump: u8,
    pub bump: u8,
}

impl StakePool {
    pub const LEN: usize = 8
        + (32 * 4)
        + (2 * 3)
        + (8 * 4)
        + 1
        + 8
        + 3 + 8;

    pub fn get_apy_for_tier(&self, tier: u8) -> u16 {
        match tier {
            0 => self.flex_apy,
            1 => self.core_apy,
            2 => self.prime_apy,
            _ => self.flex_apy,
        }
    }
}
