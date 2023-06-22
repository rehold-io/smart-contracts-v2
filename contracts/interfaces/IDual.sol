// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.17;

struct Dual {
  address user;
  uint256 chainId;
  bytes32 parentId;
  address baseToken;
  address quoteToken;
  address inputToken;
  uint256 inputAmount;
  address outputToken;
  uint256 outputAmount;
  uint256 yield;
  uint256 initialPrice;
  uint256 closedPrice;
  uint256 finishAt;
}

struct Tariff {
  uint256 chainId;
  address baseToken;
  address quoteToken;
  uint256 stakingPeriod;
  uint256 yield;
}

interface IDualFactory {
  event DualCreated(
    bytes32 indexed id,
    address indexed user,
    uint256 indexed chainId,
    bytes32 parentId,
    address baseToken,
    address quoteToken,
    address inputToken,
    uint256 inputAmount,
    uint256 yield,
    uint256 initialPrice,
    uint256 finishAt
  );

  event DualClaimed(
    bytes32 indexed id,
    address indexed user,
    uint256 indexed chainId,
    bytes32 parentId,
    address outputToken,
    uint256 outputAmount,
    uint256 closedPrice,
    uint256 finishAt
  );

  event DualReplayed(
    bytes32 indexed id,
    address indexed user,
    uint256 indexed chainId,
    bytes32 parentId,
    address outputToken,
    uint256 outputAmount,
    uint256 closedPrice,
    uint256 finishAt
  );

  struct Input {
    address user;
    bytes32 parentId;
    address token;
    uint256 amount;
    uint256 initialPrice;
    uint256 startedAt;
  }

  struct ReplayInput {
    uint256 initialPrice;
    uint256 startedAt;
  }

  function duals(bytes32) external view returns (bool);

  function create(Tariff memory tariff, Input memory input) external;

  function claim(Dual memory dual) external;

  function replay(Dual memory dual, Tariff memory tariff, ReplayInput memory input) external;
}
