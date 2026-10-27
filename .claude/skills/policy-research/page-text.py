"""Turns a saved HTML page into plain text, one block per line: python -I -X utf8 page-text.py <page.html> <out.txt>."""
import html
import re
import sys

source = open(sys.argv[1], encoding='utf-8', errors='replace').read()
source = re.sub(r'<(script|style|noscript|svg)[^>]*>.*?</\1>', ' ', source, flags=re.S | re.I)
# Block elements end a line.
source = re.sub(r'</?(p|div|li|h[1-6]|br|tr|section|article|ul|ol|table|header|footer|dd|dt)[^>]*>', '\n', source, flags=re.I)
text = html.unescape(re.sub(r'<[^>]+>', ' ', source))
lines = [re.sub(r'[ \t ]+', ' ', line).strip() for line in text.split('\n')]
lines = [line for line in lines if line]
open(sys.argv[2], 'w', encoding='utf-8', newline='\n').write('\n'.join(lines) + '\n')
print(f'{sys.argv[2]}: {len(lines)} lines, {sum(len(line) for line in lines)} chars')
