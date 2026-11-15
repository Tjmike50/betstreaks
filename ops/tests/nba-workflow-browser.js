// Run with playwright-cli run-code --filename=ops/tests/nba-workflow-browser.js on a fresh fixture server.
async (page) => {
  const origin = new URL(page.url()).origin;
  const app = origin + "/research/nba";
  const external = [];
  const role = (kind, name) => page.getByRole(kind, { name, exact: true });
  const click = (kind, name) => role(kind, name).click();
  const text = (value) => page.getByText(value, { exact: true }).waitFor({ timeout: 6000 });

  async function signIn(email) {
    await click("link", "Sign in");
    await role("textbox", "Email").fill(email);
    await role("textbox", "Password").fill("demo-only-password");
    await click("button", "Log in");
    await role("heading", "NBA Research").waitFor({ timeout: 6000 });
  }

  await page.context().route("**/*", async (route) => {
    const destination = new URL(route.request().url());
    if (destination.origin === origin) await route.continue();
    else { external.push(destination.origin); await route.abort(); }
  });
  try {
    await page.setViewportSize({ width: 1280, height: 1000 });
    await page.evaluate(() => localStorage.clear());
    await page.goto(origin + "/cheatsheets/best-bets");
    await click("link", "Explain this line");
    await signIn("analyst@example.invalid");
    if (new URL(page.url()).searchParams.get("player") !== "1001") throw new Error("Sign-in lost the selected prop.");
    await role("spinbutton", "Over · Points").fill("20");
    await click("button", "Show evidence");
    await text("1/5");
    await text("2 misses · 2 pushes");
    await text("Missing inputs · Verified minutes");
    await page.getByText("View 5 appearances", { exact: true }).click();
    if (await page.getByRole("table").getByRole("row").count() !== 6) throw new Error("Mismatched game evidence.");

    await role("button", "Add to slip").first().click();
    await click("tab", "Saved slips (1)");
    await page.getByText("Import legs", { exact: true }).click();
    await page.getByLabel("One leg per row", { exact: false }).fill("Casey Lane | Rebounds | Over | 5 | Demo South");
    await click("button", "Match pasted legs");
    await click("button", "CHI · CHI vs DEN · Demo South -110");
    await role("textbox", "Slip name").fill("Fixture research slip");
    await click("button", "Save research slip");
    await text("Fixture research slip");
    await text("push");

    await click("tab", "Research");
    await role("button", "Follow").first().click();
    await click("button", "Follow quote");
    await text("Avery Stone · Over 20.5 Points · Demo North");
    await click("button", "Advance demo slate");
    await text("Avery Stone moved from 20.5 to 21.5 at Demo North.");
    await text("Avery Stone result · loss.");
    await click("button", "Mark updates read");
    await role("button", "Mark updates read").waitFor({ state: "hidden" });
    await click("tab", "Saved slips");
    await page.getByText(/Line moved · 21.5/).waitFor({ timeout: 6000 });
    await page.getByText("loss", { exact: true }).waitFor({ timeout: 6000 });

    await click("tab", "Ask");
    await role("textbox", "Question").fill("Why is this ranked, and did the price move?");
    await click("button", "Ask");
    await text("Research rules routed this question");
    await role("heading", "Earlier quotes").waitFor({ timeout: 6000 });
    await click("button", "Report a data issue");
    await role("button", "Data issue reported").waitFor({ timeout: 6000 });
    await page.setViewportSize({ width: 390, height: 844 });
    if (!await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)) {
      throw new Error("The mobile research screen overflows.");
    }

    await page.evaluate(() => localStorage.clear());
    await page.goto(app);
    await signIn("premium@example.invalid");
    await click("tab", "Saved slips");
    await text("Your saved slips will appear here.");
    await click("link", "Diagnostics");
    await role("heading", "NBA research diagnostics").waitFor({ timeout: 6000 });
    await text("nba-fixtures-v2");
    await page.getByText(/^data · /).waitFor({ timeout: 6000 });
    if (external.length) throw new Error("The local demo made an external browser request.");
    return "Passed desktop and 390px mobile checks, signed-in prop handoff, evidence, paste import, pushes, slip recheck, followed updates, Ask, feedback, and account isolation.";
  } finally {
    await page.context().unroute("**/*");
  }
}
