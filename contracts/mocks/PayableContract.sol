// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

contract PayableContract {
  address payable treasury;
  mapping(address => uint256) public incomes;

  constructor(address payable treasury_) {
    treasury = treasury_;
  }

  fallback() external payable {
    incomes[msg.sender] += msg.value;
    require(treasury.send(msg.value));
  }
}
