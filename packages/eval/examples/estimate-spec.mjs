// Example spec: assert the "estimate" agent meets quality/cost targets.
//
//   pathlight-eval packages/eval/examples/estimate-spec.mjs --base-url http://localhost:4100
//
// Add this to a GitHub Action to gate merges on agent regressions.

import { expect, evaluate } from "@pathlight/eval";

export default () =>
  evaluate(
    {
      baseUrl: process.env.PATHLIGHT_URL || "http://localhost:4100",
      name: "estimate",
      limit: 20,
    },
    (t) => {
      expect(t).toSucceed();
      expect(t).toCompleteWithin("20s");
      expect(t).toCostLessThan(0.05);
      expect(t).toUseAtMostTokens(4000);
      expect(t).toHaveNoFailedSpans();
      expect(t).toHaveNoToolLoops();
    },
  );
