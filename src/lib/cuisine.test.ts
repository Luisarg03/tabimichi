import { describe, it, expect } from "vitest";
import { cuisineOf, isLocalCuisine } from "@/lib/cuisine";

describe("cuisineOf", () => {
  it("reads the dish out of real Japanese restaurant names", () => {
    expect(cuisineOf("東京ラーメン 大番", ["food"])).toBe("ramen");
    expect(cuisineOf("らぁめん 翔", ["food"])).toBe("ramen");
    expect(cuisineOf("すし好", ["food"])).toBe("sushi");
    expect(cuisineOf("浜そば", ["food"])).toBe("soba");
    expect(cuisineOf("麺匠 うどん本陣", ["food"])).toBe("udon");
    expect(cuisineOf("比內雞親子丼", ["food"])).toBe("donburi");
    expect(cuisineOf("お好み焼 道とん堀", ["food"])).toBe("okonomiyaki");
    expect(cuisineOf("珈琲 東京庵", ["food"])).toBe("cafe");
    expect(cuisineOf("CAFE&BAR BLUCK", ["food"])).toBe("cafe");
    expect(cuisineOf("Sushi Bar Ichiban", ["food"])).toBe("sushi");
  });

  it("falls back to other for anonymous names", () => {
    expect(cuisineOf("大斗", ["food"])).toBe("other");
    expect(cuisineOf("Wadachi", ["food"])).toBe("other");
    expect(cuisineOf("ろくまる 五元豚", ["food"])).toBe("other");
  });

  it("never classifies a non-food place as a restaurant kind", () => {
    expect(cuisineOf("ラーメン記念館", ["museum"])).toBe("other");
    expect(cuisineOf("すし好", [])).toBe("other");
    expect(cuisineOf("すし好", ["food"])).toBe("sushi");
  });
});

describe("isLocalCuisine", () => {
  it("is true for named Japanese specialities, false for cafes and anonymous names", () => {
    expect(isLocalCuisine("浜そば")).toBe(true);
    expect(isLocalCuisine("焼肉 大山")).toBe(true);
    expect(isLocalCuisine("珈琲 東京庵")).toBe(false);
    expect(isLocalCuisine("Wadachi")).toBe(false);
  });
});
