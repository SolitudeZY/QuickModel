import urllib.request, os

vendor = os.path.join(os.path.dirname(__file__), 'app', 'static', 'vendor')
os.makedirs(vendor, exist_ok=True)

files = [
    ('https://cdn.jsdelivr.net/npm/marked/marked.min.js', 'marked.min.js'),
    ('https://cdn.jsdelivr.net/npm/katex/dist/katex.min.js', 'katex.min.js'),
    ('https://cdn.jsdelivr.net/npm/katex/dist/katex.min.css', 'katex.min.css'),
    ('https://cdn.jsdelivr.net/npm/@highlightjs/cdn-assets@11.9.0/highlight.min.js', 'highlight.min.js'),
    ('https://cdn.jsdelivr.net/npm/@highlightjs/cdn-assets@11.9.0/styles/github-dark.min.css', 'github-dark.min.css'),
]

for url, name in files:
    dest = os.path.join(vendor, name)
    print(f'Downloading {name}...', end=' ', flush=True)
    urllib.request.urlretrieve(url, dest)
    print(f'OK ({os.path.getsize(dest)//1024}KB)')

# KaTeX fonts
fonts_dir = os.path.join(vendor, 'fonts')
os.makedirs(fonts_dir, exist_ok=True)
font_base = 'https://cdn.jsdelivr.net/npm/katex/dist/fonts/'
font_files = [
    'KaTeX_Main-Regular.woff2', 'KaTeX_Main-Bold.woff2', 'KaTeX_Main-Italic.woff2',
    'KaTeX_Math-Italic.woff2', 'KaTeX_Size1-Regular.woff2', 'KaTeX_Size2-Regular.woff2',
    'KaTeX_Size3-Regular.woff2', 'KaTeX_Size4-Regular.woff2',
    'KaTeX_AMS-Regular.woff2', 'KaTeX_Caligraphic-Regular.woff2',
    'KaTeX_Fraktur-Regular.woff2', 'KaTeX_SansSerif-Regular.woff2',
    'KaTeX_Script-Regular.woff2', 'KaTeX_Typewriter-Regular.woff2',
]
for fname in font_files:
    dest = os.path.join(fonts_dir, fname)
    print(f'Downloading fonts/{fname}...', end=' ', flush=True)
    try:
        urllib.request.urlretrieve(font_base + fname, dest)
        print('OK')
    except Exception as e:
        print(f'SKIP ({e})')

print('Done.')
