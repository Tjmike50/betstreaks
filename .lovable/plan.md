

## Add Google Analytics (gtag.js) to BetStreaks

### What
Add the Google Analytics 4 tag (G-TTQT66HVDJ) to `index.html`.

### Changes
**`index.html`** — Insert the gtag.js snippet into `<head>`, just before the closing `</head>` tag:

```html
<script async src="https://www.googletagmanager.com/gtag/js?id=G-TTQT66HVDJ"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', 'G-TTQT66HVDJ');
</script>
```

No other files need changes. This is a single-file, zero-risk addition.

