import { dbGet, dbAll, dbRun } from '../utils/db.js';
import { nowSec } from '../utils/time.js';

// ─── Create ──────────────────────────────────────────────────────────────────

export async function createReview(ctx, { aptId, chatId, masterId, rating, channel }) {
  const id = `rev_${Date.now()}`;
  await dbRun(ctx,
    `INSERT INTO reviews (id, tenant_id, appointment_id, master_id, chat_id, channel, rating, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    id, ctx.tenantId, aptId || null, masterId || null, chatId, channel || 'telegram', rating, nowSec(),
  );
  return id;
}

export async function updateReviewText(ctx, reviewId, text) {
  await dbRun(ctx, 'UPDATE reviews SET text = ? WHERE id = ? AND tenant_id = ?', text, reviewId, ctx.tenantId);
}

export async function addReviewPhoto(ctx, reviewId, photoRef) {
  const row = await dbGet(ctx, 'SELECT photos FROM reviews WHERE id = ? AND tenant_id = ?', reviewId, ctx.tenantId);
  let photos = [];
  try { photos = JSON.parse(row?.photos || '[]'); } catch { photos = []; }
  if (photos.length >= 3) return false;
  photos.push(photoRef);
  await dbRun(ctx, 'UPDATE reviews SET photos = ? WHERE id = ? AND tenant_id = ?', JSON.stringify(photos), reviewId, ctx.tenantId);
  return true;
}

// ─── Read ────────────────────────────────────────────────────────────────────

export async function getReviewByApt(ctx, aptId) {
  return dbGet(ctx, 'SELECT * FROM reviews WHERE appointment_id = ? AND tenant_id = ?', aptId, ctx.tenantId);
}

export async function getReviewById(ctx, reviewId) {
  return dbGet(ctx, 'SELECT * FROM reviews WHERE id = ? AND tenant_id = ?', reviewId, ctx.tenantId);
}

export async function getReviewsForTenant(ctx, { limit = 50, offset = 0, masterId, status, rating } = {}) {
  let sql = 'SELECT * FROM reviews WHERE tenant_id = ?';
  const params = [ctx.tenantId];
  if (masterId) { sql += ' AND master_id = ?'; params.push(masterId); }
  if (status) { sql += ' AND status = ?'; params.push(status); }
  if (rating) { sql += ' AND rating = ?'; params.push(rating); }
  sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);
  return dbAll(ctx, sql, ...params);
}

export async function getReviewsForMaster(ctx, masterId, { limit = 50, offset = 0 } = {}) {
  return dbAll(ctx,
    'SELECT * FROM reviews WHERE tenant_id = ? AND master_id = ? AND status != ? ORDER BY created_at DESC LIMIT ? OFFSET ?',
    ctx.tenantId, masterId, 'hidden', limit, offset,
  );
}

export async function getAverageRating(ctx, { masterId } = {}) {
  let sql = 'SELECT AVG(rating) as avg, COUNT(*) as count FROM reviews WHERE tenant_id = ? AND status != ?';
  const params = [ctx.tenantId, 'hidden'];
  if (masterId) { sql += ' AND master_id = ?'; params.push(masterId); }
  const row = await dbGet(ctx, sql, ...params);
  return { avg: row?.avg ? Math.round(row.avg * 10) / 10 : 0, count: row?.count || 0 };
}

export async function getRatingDistribution(ctx, { masterId } = {}) {
  let sql = 'SELECT rating, COUNT(*) as count FROM reviews WHERE tenant_id = ? AND status != ?';
  const params = [ctx.tenantId, 'hidden'];
  if (masterId) { sql += ' AND master_id = ?'; params.push(masterId); }
  sql += ' GROUP BY rating ORDER BY rating DESC';
  const rows = await dbAll(ctx, sql, ...params);
  const dist = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
  for (const r of rows) dist[r.rating] = r.count;
  return dist;
}

export async function getReviewCount(ctx) {
  const row = await dbGet(ctx, 'SELECT COUNT(*) as count FROM reviews WHERE tenant_id = ?', ctx.tenantId);
  return row?.count || 0;
}

// ─── Update ──────────────────────────────────────────────────────────────────

export async function updateReviewStatus(ctx, reviewId, status) {
  await dbRun(ctx, 'UPDATE reviews SET status = ? WHERE id = ? AND tenant_id = ?', status, reviewId, ctx.tenantId);
}

export async function addReviewReply(ctx, reviewId, text) {
  await dbRun(ctx,
    'UPDATE reviews SET reply_text = ?, reply_at = ? WHERE id = ? AND tenant_id = ?',
    text, nowSec(), reviewId, ctx.tenantId,
  );
}

export async function deleteReviewReply(ctx, reviewId) {
  await dbRun(ctx,
    'UPDATE reviews SET reply_text = NULL, reply_at = NULL WHERE id = ? AND tenant_id = ?',
    reviewId, ctx.tenantId,
  );
}

// ─── Public (for salon profile) ──────────────────────────────────────────────

export async function getPublicReviews(ctx, { limit = 10 } = {}) {
  return dbAll(ctx,
    `SELECT r.id, r.rating, r.text, r.photos, r.reply_text, r.reply_at, r.created_at, r.master_id
     FROM reviews r
     WHERE r.tenant_id = ? AND r.status IN ('active', 'featured')
     ORDER BY CASE WHEN r.status = 'featured' THEN 0 ELSE 1 END, r.created_at DESC
     LIMIT ?`,
    ctx.tenantId, limit,
  );
}

// ─── Cron helpers ────────────────────────────────────────────────────────────

export async function markReviewRequested(ctx, aptId) {
  await dbRun(ctx, 'UPDATE appointments SET review_requested = 1 WHERE id = ? AND tenant_id = ?', aptId, ctx.tenantId);
}
