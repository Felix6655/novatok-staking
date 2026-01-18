/// Initialize instruction handler.
///
/// Creates and configures a new staking pool with security validations.
///
/// ## Security Guarantees
/// - Vault and treasury are PDAs owned by the stake pool
/// - Mint address is locked to pool state permanently
/// - All parameters validated before storage

use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};

use crate::constants::*;
use crate::error::StakingError;
use crate::state::StakePool;

/// Accounts required for pool initialization.
///
/// ## Security Notes
/// - `staking_vault` and `treasury_vault` are PDAs with `stake_pool` as authority
/// - Seeds ensure these accounts cannot be swapped or replaced
/// - Mint is validated and locked to pool state
#[derive(Accounts)]
pub struct Initialize<'info> {
    /// The admin authority that will control the pool.
    /// SECURITY: This becomes the permanent admin stored in pool state.
    #[account(mut)]
    pub authority: Signer<'info>,

    /// The stake pool account to be created.
    /// SECURITY: PDA derived from STAKE_POOL_SEED + mint ensures uniqueness per token.
    #[account(
        init,
        payer = authority,
        space = StakePool::LEN,
        seeds = [STAKE_POOL_SEED, staking_mint.key().as_ref()],
        bump
    )]
    pub stake_pool: Account<'info, StakePool>,

    /// The mint for the staking token (NOVA).
    /// SECURITY: Validated as Account<Mint> - cannot be arbitrary account.
    pub staking_mint: Account<'info, Mint>,

    /// The vault that will hold staked tokens.
    /// SECURITY: 
    /// - PDA derived from POOL_VAULT_SEED + stake_pool
    /// - Authority set to stake_pool PDA (cannot be changed)
    /// - Mint validated to match staking_mint
    #[account(
        init,
        payer = authority,
        seeds = [POOL_VAULT_SEED, stake_pool.key().as_ref()],
        bump,
        token::mint = staking_mint,
        token::authority = stake_pool
    )]
    pub staking_vault: Account<'info, TokenAccount>,

    /// The treasury vault that will hold reward tokens.
    /// SECURITY: Same protections as staking_vault.
    #[account(
        init,
        payer = authority,
        seeds = [TREASURY_VAULT_SEED, stake_pool.key().as_ref()],
        bump,
        token::mint = staking_mint,
        token::authority = stake_pool
    )]
    pub treasury_vault: Account<'info, TokenAccount>,

    /// System program for account creation.
    pub system_program: Program<'info, System>,

    /// Token program for token account operations.
    pub token_program: Program<'info, Token>,

    /// Rent sysvar for rent-exempt calculations.
    pub rent: Sysvar<'info, Rent>,
}

/// Initialize a new staking pool.
///
/// # Security
/// - Validates all APY values are within bounds
/// - Validates emission cap is non-zero
/// - Stores vault/treasury PDAs in pool state (immutable references)
/// - Stores mint in pool state (locked permanently)
///
/// # Arguments
/// * `ctx` - Initialize accounts context
/// * `emission_cap` - Maximum total rewards distributable
/// * `flex_apy` - Flex tier APY (basis points)
/// * `core_apy` - Core tier APY (basis points)
/// * `prime_apy` - Prime tier APY (basis points)
///
/// # Returns
/// Result indicating success or error
pub fn handler(
    ctx: Context<Initialize>,
    emission_cap: u64,
    flex_apy: u16,
    core_apy: u16,
    prime_apy: u16,
) -> Result<()> {
    // === INPUT VALIDATION ===
    
    // Validate emission cap is non-zero
    require!(emission_cap > 0, StakingError::ZeroEmissionCap);
    
    // Validate APY values don't exceed maximum (50%)
    require!(flex_apy <= MAX_APY, StakingError::ApyTooHigh);
    require!(core_apy <= MAX_APY, StakingError::ApyTooHigh);
    require!(prime_apy <= MAX_APY, StakingError::ApyTooHigh);

    // === SECURITY VERIFICATION ===
    
    // Verify vault is owned by stake_pool PDA (Anchor handles this via token::authority)
    // Additional explicit check for defense in depth
    require!(
        ctx.accounts.staking_vault.owner == ctx.accounts.stake_pool.key(),
        StakingError::InvalidVaultOwner
    );
    
    require!(
        ctx.accounts.treasury_vault.owner == ctx.accounts.stake_pool.key(),
        StakingError::InvalidTreasuryOwner
    );
    
    // Verify vault mints match the staking mint
    require!(
        ctx.accounts.staking_vault.mint == ctx.accounts.staking_mint.key(),
        StakingError::InvalidTokenAccountMint
    );
    
    require!(
        ctx.accounts.treasury_vault.mint == ctx.accounts.staking_mint.key(),
        StakingError::InvalidTokenAccountMint
    );

    let stake_pool = &mut ctx.accounts.stake_pool;
    let clock = Clock::get()?;

    // === STATE INITIALIZATION ===
    // SECURITY: These values are set once and vault/treasury cannot be changed
    
    stake_pool.authority = ctx.accounts.authority.key();
    stake_pool.staking_mint = ctx.accounts.staking_mint.key();  // LOCKED - never changes
    stake_pool.staking_vault = ctx.accounts.staking_vault.key(); // LOCKED - PDA reference
    stake_pool.treasury_vault = ctx.accounts.treasury_vault.key(); // LOCKED - PDA reference
    stake_pool.flex_apy = flex_apy;
    stake_pool.core_apy = core_apy;
    stake_pool.prime_apy = prime_apy;
    stake_pool.emission_cap = emission_cap;
    stake_pool.total_distributed = 0;
    stake_pool.total_staked = 0;
    stake_pool.staker_count = 0;
    stake_pool.paused = false;
    stake_pool.created_at = clock.unix_timestamp;
    stake_pool.last_updated = clock.unix_timestamp;
    
    // Store bumps for PDA verification in future instructions
    stake_pool.bump = ctx.bumps.stake_pool;
    stake_pool.vault_bump = ctx.bumps.staking_vault;
    stake_pool.treasury_bump = ctx.bumps.treasury_vault;

    msg!("Nova Staking Pool initialized successfully");
    msg!("Admin: {}", ctx.accounts.authority.key());
    msg!("Mint: {}", ctx.accounts.staking_mint.key());
    msg!("Emission Cap: {}", emission_cap);
    msg!("APY - Flex: {}bp, Core: {}bp, Prime: {}bp", flex_apy, core_apy, prime_apy);

    Ok(())
}
