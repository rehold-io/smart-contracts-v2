// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.17;

import "./MPCManageable.sol";

abstract contract MPCOperable is MPCManageable {
  event Initialized();
  event OperatorAdded(address indexed operator, uint256 effectiveTime);
  event OperatorRemoved(address indexed operator);

  bool private _initialized;
  mapping(address => uint256) public operators;

  modifier onlyMPCOperable() {
    _checkMPCOperable();
    _;
  }

  constructor(address _MPC) MPCManageable(_MPC) {}

  function initOperators(address[] memory _operators) public onlyMPC {
    require(!_initialized, "MPCOperable: Already initialized");
    require(_operators.length > 0, "MPCOperable: Empty operators");

    _initialized = true;

    for (uint256 i = 0; i < _operators.length; i++) {
      _addOperator(_operators[i], 0);
    }

    emit Initialized();
  }

  function initialized() public view returns (bool) {
    return _initialized;
  }

  function addOperator(address operator) public onlyMPC {
    _addOperator(operator, DELAY);
  }

  function removeOperator(address operator) public onlyMPC {
    require(operators[operator] != 0, "MPCOperable: Operator doesn't exist");

    delete operators[operator];

    emit OperatorRemoved(operator);
  }

  function _addOperator(address operator, uint256 delay) private {
    require(operator != address(0x0), "MPCOperable: Nullable operator");
    require(operators[operator] == 0, "MPCOperable: Operator exists");

    operators[operator] = block.timestamp + delay;

    emit OperatorAdded(operator, operators[operator]);
  }

  function _checkMPCOperable() internal view {
    require(
      (operators[msg.sender] > 0 && block.timestamp >= operators[msg.sender]) || msg.sender == mpc(),
      "MPCOperable: Must be MPC or operator"
    );
  }
}
