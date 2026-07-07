/** @vitest-environment jsdom */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ConfirmDialog from "~/client/components/shared/ConfirmDialog";

describe("ConfirmDialog", () => {
  it("renders nothing meaningful when closed", () => {
    render(
      <ConfirmDialog
        open={false}
        title="Delete item?"
        description="This cannot be undone."
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    expect(screen.queryByText("Delete item?")).not.toBeInTheDocument();
  });

  it("renders the title, description, and default button labels when open", () => {
    render(
      <ConfirmDialog
        open
        title="Delete item?"
        description="This cannot be undone."
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    expect(screen.getByText("Delete item?")).toBeInTheDocument();
    expect(screen.getByText("This cannot be undone.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirm" })).toBeInTheDocument();
  });

  it("calls onCancel when the cancel button is clicked", async () => {
    const onCancel = vi.fn();
    const user = userEvent.setup();
    render(
      <ConfirmDialog
        open
        title="Delete item?"
        description="This cannot be undone."
        onCancel={onCancel}
        onConfirm={vi.fn()}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("calls onConfirm when the confirm button is clicked, with custom label/color", async () => {
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    render(
      <ConfirmDialog
        open
        title="Clear Calibration"
        description="This will delete all calibration data."
        onCancel={vi.fn()}
        onConfirm={onConfirm}
        confirmLabel="Clear"
        confirmColor="error"
      />,
    );
    const confirmButton = screen.getByRole("button", { name: "Clear" });
    await user.click(confirmButton);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("renders a secondary action button between cancel and confirm", async () => {
    const onSecondary = vi.fn();
    const user = userEvent.setup();
    render(
      <ConfirmDialog
        open
        title="Clear Curve Data"
        description="Choose how much to remove."
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
        confirmLabel="Clear All Data"
        secondaryAction={{
          label: "Remove Last Session",
          onClick: onSecondary,
        }}
      />,
    );
    await user.click(
      screen.getByRole("button", { name: "Remove Last Session" }),
    );
    expect(onSecondary).toHaveBeenCalledTimes(1);
  });

  it("disables all actions and shows a spinner when confirmLoading is true", () => {
    render(
      <ConfirmDialog
        open
        title="Apply Schedule to Tesla?"
        description="Apply this schedule?"
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
        confirmLoading
      />,
    );
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Confirm" })).toBeDisabled();
  });
});
