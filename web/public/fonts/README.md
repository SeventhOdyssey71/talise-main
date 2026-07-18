# TWK Everett — display font for the v3 landing

TWK Everett is a **licensed Weltkern typeface** (https://weltkern.com). It is
not redistributable, so the font files are intentionally **not** committed here.

To activate it on the `/v3` landing, drop the licensed WebFont files into this
folder with these exact names (the `@font-face` rules in `app/v3/v3.css` point
at them):

```
web/public/fonts/TWKEverett-Regular.woff2    (weight 400)
web/public/fonts/TWKEverett-Medium.woff2     (weight 500)
web/public/fonts/TWKEverett-SemiBold.woff2   (weight 600)
web/public/fonts/TWKEverett-Bold.woff2       (weight 700)
```

That's it — no code change needed. Until the files are present, the headings
fall back to **Hanken Grotesk** (the closest free grotesque), and the requested
**−0.02em (−2) letter-spacing** is already applied either way.

If you only have `.otf`/`.ttf`, convert to `.woff2` first (e.g. `npx
glyphhanger` / `fonttools ttLib.woff2`) for a much smaller download.
