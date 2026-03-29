export function tablesFromSql(src) {
  const re = /CREATE TABLE IF NOT EXISTS\s+(\w+)\s*\(/gi;
  const out = new Set();
  let m;
  while ((m = re.exec(src)) !== null) out.add(m[1]);
  return out;
}

export function tablesFromDrizzle(src) {
  const re = /sqliteTable\s*\(\s*["']([^"']+)["']/g;
  const out = new Set();
  let m;
  while ((m = re.exec(src)) !== null) out.add(m[1]);
  return out;
}

export function tableColumnsFromSql(src) {
  const re = /CREATE TABLE IF NOT EXISTS\s+(\w+)\s*\(([\s\S]*?)\);/gi;
  const out = new Map();
  let m;
  while ((m = re.exec(src)) !== null) {
    const [, tableName, body] = m;
    const columns = [];
    for (const rawLine of body.split('\n')) {
      const line = rawLine.trim().replace(/,$/, '');
      if (!line) continue;
      if (/^(PRIMARY|UNIQUE|FOREIGN|CONSTRAINT|CHECK)\b/i.test(line)) continue;
      const colMatch = /^(\w+)\s+/i.exec(line);
      if (colMatch) columns.push(colMatch[1]);
    }
    out.set(tableName, columns);
  }
  return out;
}

export function tableColumnsFromDrizzle(src) {
  const tableStartRe = /sqliteTable\s*\(\s*["']([^"']+)["']\s*,\s*\{/g;
  const out = new Map();
  let m;

  while ((m = tableStartRe.exec(src)) !== null) {
    const tableName = m[1];
    let idx = tableStartRe.lastIndex;
    let depth = 1;

    while (idx < src.length && depth > 0) {
      const ch = src[idx++];
      if (ch === '{') depth += 1;
      else if (ch === '}') depth -= 1;
    }

    const body = src.slice(tableStartRe.lastIndex, idx - 1);
    const columns = [];
    const columnRe = /:\s*[a-zA-Z]+\("([^"]+)"\)/g;
    let col;
    while ((col = columnRe.exec(body)) !== null) {
      columns.push(col[1]);
    }
    out.set(tableName, columns);
    tableStartRe.lastIndex = idx;
  }

  return out;
}
