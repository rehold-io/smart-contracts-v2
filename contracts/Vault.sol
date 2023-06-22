// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.17;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/draft-IERC20Permit.sol";

import "./access/MPCOperable.sol";
import "./interfaces/IVault.sol";
import "./interfaces/IWETH.sol";

contract Vault is MPCOperable, IVault {
  using SafeERC20 for IERC20;
  using SafeERC20 for IERC20Permit;

  address public immutable WETH;

  constructor(address _WETH, address _MPC) MPCOperable(_MPC) {
    WETH = _WETH;
  }

  receive() external payable {}

  function deposit() external payable {}

  function depositToMPC() external payable {
    _withdraw(payable(mpc()), msg.value);
  }

  function depositTokens(address from, address token, uint256 amount) external onlyMPCOperable {
    _depositTokens(from, token, amount);
  }

  function depositTokensToMPC(address from, address token, uint256 amount) external onlyMPCOperable {
    _depositTokensToMPC(from, token, amount);
  }

  function depositTokensWithPermit(
    address from,
    address token,
    uint256 amount,
    Permit calldata permit
  ) external onlyMPCOperable {
    IERC20Permit(token).permit(from, address(this), permit.amount, permit.deadline, permit.v, permit.r, permit.s);
    _depositTokens(from, token, amount);
  }

  function depositTokensToMPCWithPermit(
    address from,
    address token,
    uint256 amount,
    Permit calldata permit
  ) external onlyMPCOperable {
    IERC20Permit(token).permit(from, address(this), permit.amount, permit.deadline, permit.v, permit.r, permit.s);
    _depositTokensToMPC(from, token, amount);
  }

  function withdraw(address payable to, uint256 amount) external onlyMPCOperable {
    _withdraw(to, amount);
  }

  function withdrawTokens(address to, address token, uint256 amount) external onlyMPCOperable {
    IERC20(token).safeTransfer(to, amount);
  }

  function _depositTokens(address from, address token, uint256 amount) internal {
    IERC20(token).safeTransferFrom(from, address(this), amount);

    if (token == WETH) {
      IWETH(WETH).withdraw(amount);
    }
  }

  function _depositTokensToMPC(address from, address token, uint256 amount) internal {
    if (token == WETH) {
      IERC20(token).safeTransferFrom(from, address(this), amount);
      IWETH(WETH).withdraw(amount);
      _withdraw(payable(mpc()), amount);
    } else {
      IERC20(token).safeTransferFrom(from, mpc(), amount);
    }
  }

  function _withdraw(address payable to, uint256 amount) private {
    (bool success, ) = to.call{value: amount}("");
    require(success, "Vault: Sending ETH has been failed");
  }
}
