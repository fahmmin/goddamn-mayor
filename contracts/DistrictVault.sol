// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC4626} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title DistrictVault - one share class per city district.
/// @notice Deliberately a STOCK ERC-4626. totalAssets() is the real token
///         balance and nothing overrides it, so deposit / withdraw / convert
///         math is OpenZeppelin's audited implementation rather than ours.
///
///         Share price moves because CityOracle genuinely moves CityUSD as the
///         district's land value moves. A gain needs no code here at all - the
///         oracle simply transfers tokens in and totalAssets() rises on its
///         own. Only a loss needs cooperation, which is what remit() is.
///
///         Underwriting a term is therefore a real ERC-4626 position: no
///         synthetic accounting, no oracle-inflated totalAssets, nothing a
///         standardized subgraph has to special-case.
contract DistrictVault is ERC4626 {
    using SafeERC20 for IERC20;

    /// @notice Index into MM.districts.LIST. Never reordered - it is the onchain id.
    uint8 public immutable districtId;

    /// @notice The only address allowed to call remit().
    address public immutable oracle;

    /// @notice The district's ENS name, e.g. "riverside.cityhall.eth".
    string public ensName;

    /// @notice A single settlement may never move more than 5% of the vault's
    ///         assets out. A bad term should visibly hurt; it must not be able
    ///         to empty the vault in one transaction, whatever the oracle says.
    uint256 public constant MAX_REMIT_BPS = 500;

    event Remitted(uint256 amount, uint256 assetsAfter);

    error NotOracle();
    error RemitExceedsCap(uint256 requested, uint256 cap);

    constructor(
        IERC20 asset_,
        address oracle_,
        uint8 districtId_,
        string memory ensName_,
        string memory name_,
        string memory symbol_
    ) ERC20(name_, symbol_) ERC4626(asset_) {
        oracle = oracle_;
        districtId = districtId_;
        ensName = ensName_;
    }

    /// @notice Pay losses back to the oracle's reserve. Capped per call.
    /// @dev    Gains need no counterpart: the oracle transfers straight in.
    function remit(uint256 amount) external returns (uint256 sent) {
        if (msg.sender != oracle) revert NotOracle();
        uint256 cap = (totalAssets() * MAX_REMIT_BPS) / 10_000;
        if (amount > cap) revert RemitExceedsCap(amount, cap);
        sent = amount;
        IERC20(asset()).safeTransfer(oracle, sent);
        emit Remitted(sent, totalAssets());
    }
}
