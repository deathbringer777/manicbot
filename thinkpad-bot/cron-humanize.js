// Turn a 5-field cron expression into a human-readable Russian phrase.
// Unknown / complex combos fall back to the raw expression, so callers can
// always show *something* sensible.

const DOW_PLURAL = {
  0: "по воскресеньям",
  7: "по воскресеньям",
  1: "по понедельникам",
  2: "по вторникам",
  3: "по средам",
  4: "по четвергам",
  5: "по пятницам",
  6: "по субботам",
};

const pad = (n) => String(n).padStart(2, "0");

function humanizeCron(expr) {
  const raw = String(expr || "").trim();
  const parts = raw.split(/\s+/);
  if (parts.length !== 5) return raw;
  const [min, hour, dom, mon, dow] = parts;

  if (raw === "* * * * *") return "каждую минуту";

  let m = min.match(/^\*\/(\d+)$/);
  if (m && hour === "*" && dom === "*" && mon === "*" && dow === "*") {
    return `каждые ${m[1]} мин`;
  }

  m = hour.match(/^\*\/(\d+)$/);
  if (m && /^\d+$/.test(min) && dom === "*" && mon === "*" && dow === "*") {
    const at = Number(min) === 0 ? "" : ` (в :${pad(min)})`;
    return `каждые ${m[1]} ч${at}`;
  }

  if (/^\d+$/.test(min) && hour === "*" && dom === "*" && mon === "*" && dow === "*") {
    return `каждый час в :${pad(min)}`;
  }

  const timeKnown = /^\d+$/.test(min) && /^\d+$/.test(hour);
  const time = timeKnown ? `${pad(hour)}:${pad(min)}` : null;

  // Weekly — specific day-of-week.
  if (time && dom === "*" && mon === "*" && dow !== "*") {
    if (dow === "1-5" || dow === "1,2,3,4,5") return `по будням в ${time}`;
    if (dow === "0,6" || dow === "6,0" || dow === "6,7" || dow === "0,7,6") {
      return `по выходным в ${time}`;
    }
    if (/^\d$/.test(dow) && DOW_PLURAL[dow]) return `${DOW_PLURAL[dow]} в ${time}`;
    return `дни недели [${dow}] в ${time}`;
  }

  // Monthly — specific day-of-month.
  if (time && /^\d+$/.test(dom) && mon === "*" && dow === "*") {
    return `${Number(dom)}-го числа в ${time}`;
  }

  // Daily.
  if (time && dom === "*" && mon === "*" && dow === "*") {
    return `каждый день в ${time}`;
  }

  return raw;
}

module.exports = { humanizeCron };
