import fs from "fs";

async function initStealthPuppeteer() {
  const puppeteerExtra = (await import("puppeteer-extra")).default;
  const StealthPlugin = (await import("puppeteer-extra-plugin-stealth")).default;
  puppeteerExtra.use(StealthPlugin());
  return puppeteerExtra;
}

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function slugify(name: string) {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/['".]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export async function fetchAllProducts(url: string) {
  const puppeteer = await initStealthPuppeteer();
  let products: any[] = [];

  const browser = await puppeteer.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
    ],
    defaultViewport: { width: 1366, height: 900 },
  });

  try {
    const page = await browser.newPage();

    // 🧠 Intercept requests — keep minimal resources, allow images for JS triggers
    await page.setRequestInterception(true);
    page.on("request", (req) => {
      const type = req.resourceType();
      if (["font", "media"].includes(type)) {
        req.abort();
      } else {
        req.continue();
      }
    });

    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0 Safari/537.36"
    );
    await page.setExtraHTTPHeaders({
      "Accept-Language": "en-US,en;q=0.9",
    });

    // 🍪 Load cookies if available
    if (fs.existsSync("cookies.json")) {
      try {
        let cookies = JSON.parse(fs.readFileSync("cookies.json", "utf-8"));
        cookies = cookies.map((c: any) => {
          const fixed = { ...c };
          if (
            typeof fixed.sameSite !== "string" ||
            !["Strict", "Lax", "None"].includes(fixed.sameSite)
          )
            delete fixed.sameSite;
          if (fixed.expires && typeof fixed.expires !== "number")
            delete fixed.expires;
          return fixed;
        });
        await page.setCookie(...cookies);
        console.log(`🍪 Loaded ${cookies.length} cookies (cleaned)`);
      } catch (e) {
        console.warn("⚠️ Failed to read cookies.json:", e);
      }
    }

    console.log("🔗 Opening page:", url);
    await page.goto(url, { waitUntil: "networkidle2", timeout: 180000 }); // ⏳ 3 min timeout

    // Wait until products appear
    await page.waitForSelector("a.qa--product-tile__link", { timeout: 20000 });
    await delay(8000);

    // 📸 Debug screenshot
    await page.screenshot({ path: "page_debug.png", fullPage: false });

    // 🌀 Scroll dynamically with long delays (for 1 Mbps servers)
    let prevCount = 0;
    let scrollCount = 0;
    const startTime = Date.now();
    const maxTime = 2 * 60 * 1000; // 2 min

    while (Date.now() - startTime < maxTime) {
      const currentCount = await page.$$eval("a.qa--product-tile__link", els => els.length);
      if (currentCount > prevCount) {
        prevCount = currentCount;
        scrollCount++;
        console.log(`↕️ Scroll #${scrollCount}, loaded: ${currentCount}`);
        await page.evaluate("window.scrollTo(0, document.body.scrollHeight)");
        await delay(6000); // ⏳ slower wait between scrolls
      } else {
        console.log("✅ All products loaded or scroll limit reached.");
        break;
      }
    }

    // === Extract product data ===
    products = await page.evaluate(() => {
      const list: any[] = [];
      document.querySelectorAll("a.qa--product-tile__link").forEach((el) => {
        const name = (el.querySelector(".product-tile-name") as HTMLElement)?.innerText?.trim();
        const orig = (el.querySelector(".qa--product-tile__original-price") as HTMLElement)?.innerText?.trim() || "";
        const sale = (el.querySelector(".qa--product-tile__minRange-price") as HTMLElement)?.innerText?.trim() || "";
        const href = (el as HTMLAnchorElement)?.getAttribute("href");

        if (name && href) {
          list.push({
            name,
            originalPrice: orig,
            salePrice: sale,
            link: `https://outlet.arcteryx.com${href}`,
          });
        }
      });
      return list;
    });

    console.log(`✅ Scraping completed. Found ${products.length} products.`);

    const newCookies = await page.cookies();
    fs.writeFileSync("cookies.json", JSON.stringify(newCookies, null, 2));
    console.log(`💾 Saved ${newCookies.length} updated cookies to cookies.json`);
  } catch (e) {
    console.error("Scraping failed:", e);
  } finally {
    await browser.close();
  }

  return products.map((p) => ({
    ...p,
    slug: slugify(p.name),
  }));
}
