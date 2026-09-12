// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title CityUSD - the city's unit of account on Sepolia.
/// @notice A test-only ERC20 with an open faucet. A judge with a fresh embedded
///         wallet needs spendable balance in one click, so the faucet is public
///         and rate-limited per address rather than gated on an allowlist.
///         This is a testnet instrument and is not redeemable for anything.
contract CityUSD is ERC20 {
    uint256 public constant FAUCET_AMOUNT = 10_000e18;
    uint256 public constant FAUCET_COOLDOWN = 1 hours;

    /// @notice Last faucet draw per address, so one wallet cannot drain in a loop.
    mapping(address => uint256) public lastDraw;

    /// @notice Treasury may mint to fund vault settlement. Set once at deploy.
    address public immutable treasury;

    event FaucetDrawn(address indexed to, uint256 amount);

    error FaucetCooldown(uint256 availableAt);
    error NotTreasury();

    constructor(address treasury_) ERC20("City Dollar", "CITYUSD") {
        treasury = treasury_;
        // Seed the treasury so settlement has something to move on day one.
        _mint(treasury_, 100_000_000e18);
    }

    /// @notice Draw test funds. Anyone, once per cooldown.
    function faucet() external {
        uint256 ready = lastDraw[msg.sender] + FAUCET_COOLDOWN;
        if (lastDraw[msg.sender] != 0 && block.timestamp < ready) {
            revert FaucetCooldown(ready);
        }
        lastDraw[msg.sender] = block.timestamp;
        _mint(msg.sender, FAUCET_AMOUNT);
        emit FaucetDrawn(msg.sender, FAUCET_AMOUNT);
    }

    /// @notice Treasury tops itself up when settlement has drained the reserve.
    function mintToTreasury(uint256 amount) external {
        if (msg.sender != treasury) revert NotTreasury();
        _mint(treasury, amount);
    }
}
