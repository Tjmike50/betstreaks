// Run with playwright-cli run-code --filename=ops/tests/analytics-browser.js.
async (page) => {
  const origin = "http://127.0.0.1:47961";
  const failureDemo = page.url().endsWith("#fail-source");
  const appUrl = origin + "/research/analytics";
  const external = [];
  await page.context().route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === origin) await route.continue();
    else {
      external.push(url.origin);
      await route.abort();
    }
  });

  try {
    await page.context().clearCookies();
    await page.evaluate(() => localStorage.clear());
    await page.goto(appUrl);
    await page.getByRole("heading", { name: "Sign in to use the assistant" }).waitFor();
    await page.getByRole("link", { name: "Sign in", exact: true }).click();
    await page.getByLabel("Email").fill("analyst@example.invalid");
    await page.getByLabel("Password", { exact: true }).fill("demo-only-password");
    await page.getByRole("button", { name: "Log in", exact: true }).click();
    await page.waitForURL(appUrl);
    await page.getByRole("heading", { name: "AI Analytics Assistant" }).waitFor();

    await page.getByRole("button", { name: "Average points", exact: true }).click();
    if (failureDemo) {
      await page.getByRole("alert").filter({ hasText: "The game-log source is unavailable." }).waitFor();
      if (await page.getByRole("table", { name: "Selected appearance evidence" }).count()) {
        throw new Error("An unavailable source rendered game evidence.");
      }
      if (external.length) throw new Error("Unexpected requests outside the loopback server.");
      return "Signed-out gate, sign-in and safe source failure passed.";
    }

    await page.getByText("Sum ÷ known appearances = 95 ÷ 5 = 19", { exact: true }).waitFor();
    const source = page.getByRole("region", { name: "Source and dates" });
    await source.getByText("nba-fixtures-v1", { exact: true }).waitFor();
    await source.getByText("Frozen synthetic snapshot").waitFor();
    const evidence = page.getByRole("table", { name: "Selected appearance evidence" });
    if (await evidence.getByRole("row").count() !== 6) throw new Error("Expected five evidence rows and one header.");

    await page.getByRole("button", { name: "What about rebounds?" }).click();
    await page.getByText("Sum ÷ known appearances = 30 ÷ 5 = 6", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Ambiguous player", exact: true }).click();
    await page.getByRole("heading", { name: "Which player did you mean?" }).waitFor();
    await page.getByRole("button", { name: "Jordan Reed · NYK", exact: true }).click();
    await page.getByRole("heading", { name: "Jordan Reed · NYK" }).waitFor();
    await page.getByText("Sum ÷ known appearances = 20 ÷ 5 = 4", { exact: true }).waitFor();

    await page.getByRole("button", { name: "At least 20 points", exact: true }).click();
    await page.getByText("3 / 5", { exact: true }).waitFor();
    await page.getByText(/3 of 5 appearances met ≥ 20/).waitFor();
    await page.getByRole("textbox", { name: "Ask an NBA stats question" })
      .fill("How many times did Avery Stone score more than 20 points in the last 5 games?");
    await page.getByRole("button", { name: "Ask", exact: true }).click();
    await page.getByText("1 / 5", { exact: true }).waitFor();
    await page.getByText(/including 2 pushes/).waitFor();

    await page.setViewportSize({ width: 390, height: 844 });
    if (!await page.evaluate(() => document.documentElement.scrollWidth === innerWidth)) {
      throw new Error("The mobile route has horizontal overflow.");
    }
    await page.setViewportSize({ width: 1280, height: 1080 });
    if (external.length) throw new Error("Unexpected requests outside the loopback server.");
    return "Signed-out gate, sign-in, provenance, five evidence rows, follow-up, clarification, both thresholds and mobile layout passed.";
  } finally {
    await page.context().unroute("**/*");
  }
}
