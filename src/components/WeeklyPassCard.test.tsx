import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { afterEach, describe, it, expect, vi } from "vitest";
import { WeeklyPassCard } from "./WeeklyPassCard";
afterEach(cleanup);
const props = { onWeeksChange: vi.fn(), onCheckout: vi.fn(), loading: false, loggedIn: true, expiresAt: null };
describe("prepaid weekly pricing", () => {
  it.each([["9", "$45"], ["43", "$215"]])("prices %s weeks as %s upfront", (weeks, total) => {
    render(<WeeklyPassCard {...props} weeks={weeks} />);
    expect(screen.getByText(total)).toBeInTheDocument();
    expect(screen.getByText(/No automatic renewal/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button"));
    expect(props.onCheckout).toHaveBeenCalled();
  });
  it.each(["", "0", "1.5", "-2", "521"])("disables invalid quantity %s", weeks => {
    render(<WeeklyPassCard {...props} weeks={weeks} />);
    expect(screen.getByRole("button")).toBeDisabled();
  });
});
