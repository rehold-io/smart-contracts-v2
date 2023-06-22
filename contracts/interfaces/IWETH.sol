// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.17;

interface IWETH {
  function name() external view returns (string memory);

  function symbol() external view returns (string memory);

  function decimals() external view returns (uint8);

  function balanceOf(address) external view returns (uint256);

  function allowance(address, address) external view returns (uint256);

  function deposit() external payable;

  function withdraw(uint256) external;

  function approve(address guy, uint256 wad) external returns (bool);

  function transfer(address to, uint256 value) external returns (bool);

  function transferFrom(address src, address dst, uint256 amount) external returns (bool);
}
