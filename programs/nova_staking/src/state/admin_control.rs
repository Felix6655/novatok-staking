use anchor_lang::prelude::*;

#[account]
pub struct AdminControl {
    pub admin: Pubkey,
    pub paused: bool,
    pub bump: u8,
    pub _reserved: [u8; 64],
}

impl Default for AdminControl {
    fn default() -> Self {
        Self {
            admin: Pubkey::default(),
            paused: false,
            bump: 0,
            _reserved: [0u8; 64],
        }
    }
}
