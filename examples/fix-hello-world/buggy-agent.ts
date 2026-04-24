import { Pathlight } from "@pathlight/sdk";

const tl = new Pathlight({ baseUrl: process.env.PATHLIGHT_URL ?? "http://localhost:4100" });

interface Item {
  sku: string;
  price: number;
}

function averagePrice(items: Item[]): number {
  return items.reduce((sum, i) => sum + i.price, 0) / items.length;
}

async function main() {
  const trace = tl.trace("average-price-agent", { itemCount: 0 });
  const span = trace.span("averagePrice", "custom", { input: { items: [] } });

  try {
    const avg = averagePrice([]);
    if (!Number.isFinite(avg)) {
      throw new Error(`averagePrice returned non-finite: ${avg}`);
    }
    await span.end({ output: avg, status: "completed" });
    await trace.end({ output: { avg }, status: "completed" });
    console.log("trace completed:", await trace.id);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await span.end({ error: message, status: "failed" });
    await trace.end({ error: message, status: "failed" });
    console.error("trace failed:", await trace.id);
    process.exit(1);
  }
}

main();
