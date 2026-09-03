# Banner artwork prompt — "blue hour: Ghibli meadow, Night City rising"

Aspect 16:9 (the swap script crops to 2.4:1). Left third must stay calm and dark for the title.

Ultrawide painterly landscape, Studio Ghibli background art meets Claude Monet impressionism, no people, no characters.
Blue hour just after sunset. Foreground: a lush green hillside meadow rolling in from the lower left, thick with red, pink
and orange wildflowers and soft grasses in loose impressionist brushstrokes, a few petals drifting in the air.
Middle: enormous towering cumulus clouds catching the last peach and rose light, a distant snow-capped mountain range behind them.
Right third: a vast cyberpunk megacity rising out of the evening haze beyond the meadow, dark spires and layered towers,
thousands of tiny windows and holographic signs glowing warm yellow and electric cyan, a few airship lights, the neon
reflecting softly on the underside of the clouds. Left third of the frame: calm deep blue-violet twilight sky with only
faint thin clouds, kept quiet and dark for typography. Rich painterly texture, visible brushwork, soft atmospheric depth,
gentle film grain. Palette: deep blue-violet sky, peach clouds, emerald greens, coral flowers, warm yellow and cyan neon accents.
No text, no watermark, no logo.

Negative / avoid: people, faces, characters, text, letters, logos, harsh HDR, photorealism, daylight.

Variants worth trying:
- "golden hour" instead of blue hour → brighter, more Howl; then set `bannerDarken` to 0.75 in profile/config.json.
- "Monet water lilies pond in the foreground reflecting the neon city" → more abstract, very Monet.
- "the meadow is on the roof of a tower, the city far below" → more cyberpunk.

Install: `scripts/set-banner.sh path/to/image.png 0.45` (second number = vertical anchor, 0 top … 1 bottom).
