// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/draft-ERC20Permit.sol";
import "@openzeppelin/contracts/utils/Context.sol";

contract Token is ERC20Permit {
  uint8 private _decimals;

  constructor(string memory name_, string memory symbol_, uint8 decimals_) ERC20Permit(name_) ERC20(name_, symbol_) {
    _decimals = decimals_;
    _mint(msg.sender, 10 ** 28);
  }

  function decimals() public view virtual override returns (uint8) {
    return _decimals;
  }
}
