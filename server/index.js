import express from 'express';
import cors from 'cors';
import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
const dir = path.dirname(fileURLToPath(import.meta.url));
const db = new Database(process.env.DB_PATH || path.join(dir, 'club.db'));
db.pragma('foreign_keys=ON');
db.pragma('journal_mode=WAL');
db.pragma('busy_timeout=5000');
db.exec(`CREATE TABLE IF NOT EXISTS roles(id INTEGER PRIMARY KEY,name TEXT UNIQUE NOT NULL);
CREATE TABLE IF NOT EXISTS trainers(id INTEGER PRIMARY KEY,full_name TEXT NOT NULL,specialization TEXT NOT NULL,phone TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY,username TEXT UNIQUE NOT NULL,password_hash TEXT NOT NULL,role_id INTEGER NOT NULL REFERENCES roles(id),trainer_id INTEGER REFERENCES trainers(id),active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS clients(id INTEGER PRIMARY KEY,full_name TEXT NOT NULL,phone TEXT NOT NULL,birth_date TEXT,registered_at TEXT NOT NULL DEFAULT (date('now')),status TEXT NOT NULL DEFAULT 'active');
CREATE TABLE IF NOT EXISTS membership_types(id INTEGER PRIMARY KEY,name TEXT NOT NULL,visits INTEGER NOT NULL CHECK(visits>0),duration_days INTEGER NOT NULL CHECK(duration_days>0),price REAL NOT NULL CHECK(price>=0));
CREATE TABLE IF NOT EXISTS memberships(id INTEGER PRIMARY KEY,client_id INTEGER NOT NULL REFERENCES clients(id),type_id INTEGER NOT NULL REFERENCES membership_types(id),start_date TEXT NOT NULL,end_date TEXT NOT NULL,remaining INTEGER NOT NULL CHECK(remaining>=0),status TEXT NOT NULL DEFAULT 'active',frozen_at TEXT);
CREATE TABLE IF NOT EXISTS trainings(id INTEGER PRIMARY KEY,trainer_id INTEGER NOT NULL REFERENCES trainers(id),starts_at TEXT NOT NULL,kind TEXT NOT NULL CHECK(kind IN ('group','individual')),room TEXT NOT NULL,capacity INTEGER NOT NULL CHECK(capacity>0),direction TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS bookings(id INTEGER PRIMARY KEY,client_id INTEGER NOT NULL REFERENCES clients(id),training_id INTEGER NOT NULL REFERENCES trainings(id),membership_id INTEGER NOT NULL REFERENCES memberships(id),status TEXT NOT NULL DEFAULT 'booked',UNIQUE(client_id,training_id));
CREATE TABLE IF NOT EXISTS payments(id INTEGER PRIMARY KEY,membership_id INTEGER NOT NULL REFERENCES memberships(id),amount REAL NOT NULL,paid_at TEXT NOT NULL DEFAULT (datetime('now')),note TEXT NOT NULL DEFAULT 'Продажа абонемента');
CREATE INDEX IF NOT EXISTS idx_training_time ON trainings(starts_at); CREATE INDEX IF NOT EXISTS idx_bookings_training ON bookings(training_id);`);
for (const name of ['admin', 'manager', 'trainer'])
    db.prepare('INSERT OR IGNORE INTO roles(name) VALUES(?)').run(name);
if (!db.prepare('SELECT 1 FROM trainers LIMIT 1').get())
    db.prepare('INSERT INTO trainers(full_name,specialization,phone) VALUES(?,?,?)').run('Иванов Алексей', 'Силовые тренировки', '+79990000001');
if (!db.prepare('SELECT 1 FROM membership_types LIMIT 1').get())
    for (const x of [['8 занятий', 8, 30, 3500], ['12 занятий', 12, 45, 4900], ['Разовое', 1, 1, 600]])
        db.prepare('INSERT INTO membership_types(name,visits,duration_days,price) VALUES(?,?,?,?)').run(...x);
if (!db.prepare('SELECT 1 FROM users LIMIT 1').get()) {
    for (const [name, role, trainer] of [['admin', 'admin', null], ['manager', 'manager', null], ['trainer', 'trainer', 1]])
        db.prepare('INSERT INTO users(username,password_hash,role_id,trainer_id) VALUES(?,?,(SELECT id FROM roles WHERE name=?),?)').run(name, bcrypt.hashSync('Club2026!', 12), role, trainer);
}
const app = express();
app.use(cors());
app.use(express.json({ limit: '100kb' }));
const secret = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');
const fail = (status, message) => { const e = new Error(message); e.status = status; throw e; };
const q = (sql, ...args) => db.prepare(sql).all(...args);
const one = (sql, ...args) => db.prepare(sql).get(...args);
const run = (sql, ...args) => db.prepare(sql).run(...args);
const required = (obj, fields) => {
    for (const f of fields)
        if (obj[f] === undefined || obj[f] === null || String(obj[f]).trim() === '')
            fail(400, `Поле ${f} обязательно`);
};
const datePlus = (date, days) => {
    const d = new Date(date + 'T12:00:00Z'); if (Number.isNaN(d.getTime()))
        fail(400, 'Неверная дата'); d.setUTCDate(d.getUTCDate() + Number(days)); return d.toISOString().slice(0, 10);
};
const today = () => new Date().toISOString().slice(0, 10);
function syncMemberships() { run("UPDATE memberships SET status='expired' WHERE status='active' AND (end_date < ? OR remaining=0)", today()); }
function auth(req, res, next) {
    try {
        const token = (req.headers.authorization || '').replace(/^Bearer /, '');
        const decoded = jwt.verify(token, secret);
        const user = one('SELECT u.id,u.username,r.name role,u.trainer_id FROM users u JOIN roles r ON r.id=u.role_id WHERE u.id=? AND u.active=1', decoded.id);
        if (!user)
            fail(401, 'Доступ запрещён');
        req.user = user;
        next();
    }
    catch (e) {
        res.status(401).json({ error: 'Требуется авторизация' });
    }
}
const permit = (...roles) => (req, res, next) => roles.includes(req.user.role) ? next() : next(Object.assign(new Error('Недостаточно прав'), { status: 403 }));
const wrap = fn => (req, res, next) => {
    try {
        const out = fn(req, res);
        if (out?.catch)
            out.catch(next);
    }
    catch (e) {
        next(e);
    }
};
app.post('/api/login', wrap((req, res) => {
    required(req.body, ['username', 'password']); const u = one('SELECT u.*,r.name role FROM users u JOIN roles r ON r.id=u.role_id WHERE username=? AND active=1', req.body.username); if (!u || !bcrypt.compareSync(req.body.password, u.password_hash))
        fail(401, 'Неверный логин или пароль'); res.json({ token: jwt.sign({ id: u.id }, secret, { expiresIn: '8h' }), user: { id: u.id, username: u.username, role: u.role, trainer_id: u.trainer_id } });
}));
app.get('/api/desktop-health', (req, res) => res.type('text/plain').send('sportclub-ready'));
app.use('/api', auth);
app.get('/api/me', (req, res) => res.json(req.user));
app.get('/api/clients', permit('admin', 'manager'), wrap((req, res) => res.json(q('SELECT * FROM clients WHERE full_name LIKE ? OR phone LIKE ? ORDER BY id DESC', `%${req.query.search || ''}%`, `%${req.query.search || ''}%`))));
app.post('/api/clients', permit('admin', 'manager'), wrap((req, res) => { required(req.body, ['full_name', 'phone']); const b = req.body; res.json({ id: run('INSERT INTO clients(full_name,phone,birth_date,status) VALUES(?,?,?,?)', b.full_name, b.phone, b.birth_date || null, b.status || 'active').lastInsertRowid }); }));
app.put('/api/clients/:id', permit('admin', 'manager'), wrap((req, res) => { required(req.body, ['full_name', 'phone']); const b = req.body; res.json({ changed: run('UPDATE clients SET full_name=?,phone=?,birth_date=?,status=? WHERE id=?', b.full_name, b.phone, b.birth_date || null, b.status || 'active', req.params.id).changes }); }));
app.get('/api/trainers', permit('admin', 'manager'), wrap((req, res) => res.json(q('SELECT * FROM trainers ORDER BY full_name'))));
app.post('/api/trainers', permit('admin'), wrap((req, res) => { required(req.body, ['full_name', 'specialization', 'phone']); res.json({ id: run('INSERT INTO trainers(full_name,specialization,phone) VALUES(?,?,?)', req.body.full_name, req.body.specialization, req.body.phone).lastInsertRowid }); }));
app.put('/api/trainers/:id', permit('admin'), wrap((req, res) => { required(req.body, ['full_name', 'specialization', 'phone']); res.json({ changed: run('UPDATE trainers SET full_name=?,specialization=?,phone=? WHERE id=?', req.body.full_name, req.body.specialization, req.body.phone, req.params.id).changes }); }));
app.get('/api/types', permit('admin', 'manager'), wrap((req, res) => res.json(q('SELECT * FROM membership_types'))));
app.post('/api/types', permit('admin'), wrap((req, res) => { const b = req.body; required(b, ['name', 'visits', 'duration_days', 'price']); res.json({ id: run('INSERT INTO membership_types(name,visits,duration_days,price) VALUES(?,?,?,?)', b.name, b.visits, b.duration_days, b.price).lastInsertRowid }); }));
app.get('/api/memberships', permit('admin', 'manager'), wrap((req, res) => { syncMemberships(); res.json(q('SELECT m.*,c.full_name client,t.name type FROM memberships m JOIN clients c ON c.id=m.client_id JOIN membership_types t ON t.id=m.type_id ORDER BY m.id DESC')); }));
app.post('/api/memberships', permit('admin', 'manager'), wrap((req, res) => {
    const b = req.body; required(b, ['client_id', 'type_id', 'start_date']); const t = one('SELECT * FROM membership_types WHERE id=?', b.type_id); if (!t)
        fail(404, 'Тип абонемента не найден'); if (!one('SELECT 1 FROM clients WHERE id=?', b.client_id))
        fail(404, 'Клиент не найден'); const result = db.transaction(() => { const id = run('INSERT INTO memberships(client_id,type_id,start_date,end_date,remaining) VALUES(?,?,?,?,?)', b.client_id, b.type_id, b.start_date, datePlus(b.start_date, t.duration_days - 1), t.visits).lastInsertRowid; run('INSERT INTO payments(membership_id,amount) VALUES(?,?)', id, t.price); return id; })(); res.json({ id: result });
}));
app.post('/api/memberships/:id/extend', permit('admin', 'manager'), wrap((req, res) => {
    const m = one('SELECT m.*,t.duration_days,t.visits,t.price FROM memberships m JOIN membership_types t ON t.id=m.type_id WHERE m.id=?', req.params.id); if (!m)
        fail(404, 'Абонемент не найден'); if (m.status === 'frozen')
        fail(400, 'Сначала разморозьте абонемент'); const base = m.end_date > today() ? m.end_date : today(); db.transaction(() => { run("UPDATE memberships SET end_date=?,remaining=remaining+?,status='active' WHERE id=?", datePlus(base, m.duration_days), m.visits, m.id); run("INSERT INTO payments(membership_id,amount,note) VALUES(?,?,'Продление')", m.id, m.price); })(); res.json({ ok: true });
}));
app.post('/api/memberships/:id/freeze', permit('admin', 'manager'), wrap((req, res) => {
    syncMemberships(); const m = one('SELECT * FROM memberships WHERE id=?', req.params.id); if (!m || m.status !== 'active')
        fail(400, 'Заморозить можно только активный абонемент'); run("UPDATE memberships SET status='frozen',frozen_at=? WHERE id=?", today(), m.id); res.json({ ok: true });
}));
app.post('/api/memberships/:id/unfreeze', permit('admin', 'manager'), wrap((req, res) => {
    const m = one('SELECT * FROM memberships WHERE id=?', req.params.id); if (!m || m.status !== 'frozen')
        fail(400, 'Абонемент не заморожен'); const days = Math.max(0, Math.round((new Date(today()) - new Date(m.frozen_at)) / 86400000)); run("UPDATE memberships SET status='active',frozen_at=NULL,end_date=? WHERE id=?", datePlus(m.end_date, days), m.id); syncMemberships(); res.json({ ok: true });
}));
app.post('/api/memberships/:id/close', permit('admin', 'manager'), wrap((req, res) => res.json({ changed: run("UPDATE memberships SET status='closed' WHERE id=? AND status!='closed'", req.params.id).changes })));
const trainingsSql = `SELECT t.*,tr.full_name trainer,(SELECT count(*) FROM bookings b WHERE b.training_id=t.id AND b.status IN ('booked','attended','missed')) occupied FROM trainings t JOIN trainers tr ON tr.id=t.trainer_id`;
app.get('/api/trainings', wrap((req, res) => {
    const where = [], params = []; if (req.user.role === 'trainer') {
        where.push('t.trainer_id=?');
        params.push(req.user.trainer_id);
    }
    else if (req.query.trainer_id) {
        where.push('t.trainer_id=?');
        params.push(req.query.trainer_id);
    } if (req.query.date) {
        where.push('substr(t.starts_at,1,10)=?');
        params.push(req.query.date);
    } if (req.query.kind) {
        where.push('t.kind=?');
        params.push(req.query.kind);
    } res.json(q(trainingsSql + (where.length ? ' WHERE ' + where.join(' AND ') : '') + ' ORDER BY t.starts_at', ...params));
}));
app.post('/api/trainings', permit('admin'), wrap((req, res) => {
    const b = req.body; required(b, ['trainer_id', 'starts_at', 'kind', 'room', 'capacity', 'direction']); if (b.kind === 'individual' && Number(b.capacity) !== 1)
        fail(400, 'Индивидуальная тренировка рассчитана на одного'); res.json({ id: run('INSERT INTO trainings(trainer_id,starts_at,kind,room,capacity,direction) VALUES(?,?,?,?,?,?)', b.trainer_id, b.starts_at, b.kind, b.room, b.capacity, b.direction).lastInsertRowid });
}));
app.put('/api/trainings/:id', permit('admin'), wrap((req, res) => {
    const b = req.body; required(b, ['trainer_id', 'starts_at', 'kind', 'room', 'capacity', 'direction']); const occupied = one("SELECT count(*) n FROM bookings WHERE training_id=? AND status IN ('booked','attended','missed')", req.params.id).n; if (Number(b.capacity) < occupied)
        fail(400, 'Вместимость меньше количества записанных'); res.json({ changed: run('UPDATE trainings SET trainer_id=?,starts_at=?,kind=?,room=?,capacity=?,direction=? WHERE id=?', b.trainer_id, b.starts_at, b.kind, b.room, b.capacity, b.direction, req.params.id).changes });
}));
app.get('/api/bookings', wrap((req, res) => {
    let sql = `SELECT b.*,c.full_name client,t.starts_at,t.direction FROM bookings b JOIN clients c ON c.id=b.client_id JOIN trainings t ON t.id=b.training_id`; const params = []; if (req.user.role === 'trainer') {
        sql += ' WHERE t.trainer_id=?';
        params.push(req.user.trainer_id);
    }
    else if (req.query.training_id) {
        sql += ' WHERE t.id=?';
        params.push(req.query.training_id);
    } res.json(q(sql + ' ORDER BY t.starts_at DESC', ...params));
}));
app.post('/api/bookings', permit('admin', 'manager'), wrap((req, res) => {
    const b = req.body; required(b, ['client_id', 'training_id']); const id = db.transaction(() => {
        syncMemberships(); const t = one('SELECT * FROM trainings WHERE id=?', b.training_id); if (!t)
            fail(404, 'Тренировка не найдена'); if (t.starts_at.slice(0, 10) < today())
            fail(400, 'Нельзя записаться на прошедшую тренировку'); const c = one('SELECT * FROM clients WHERE id=?', b.client_id); if (!c || c.status !== 'active')
            fail(400, 'Клиент неактивен или не найден'); const prev = one('SELECT * FROM bookings WHERE client_id=? AND training_id=?', b.client_id, b.training_id); if (prev && prev.status !== 'cancelled')
            fail(409, 'Клиент уже записан'); const occupied = one("SELECT count(*) n FROM bookings WHERE training_id=? AND status IN ('booked','attended','missed')", b.training_id).n; if (occupied >= t.capacity)
            fail(409, 'Группа заполнена'); const m = one("SELECT * FROM memberships WHERE client_id=? AND status='active' AND remaining>0 AND start_date<=? AND end_date>=? ORDER BY end_date LIMIT 1", b.client_id, t.starts_at.slice(0, 10), t.starts_at.slice(0, 10)); if (!m)
            fail(400, 'Нет действующего абонемента на дату тренировки'); if (prev) {
                run("UPDATE bookings SET status='booked',membership_id=? WHERE id=?", m.id, prev.id);
                return prev.id;
            } return run('INSERT INTO bookings(client_id,training_id,membership_id) VALUES(?,?,?)', b.client_id, b.training_id, m.id).lastInsertRowid;
    })(); res.json({ id });
}));
app.post('/api/bookings/:id/cancel', permit('admin', 'manager'), wrap((req, res) => {
    const b = one('SELECT * FROM bookings WHERE id=?', req.params.id); if (!b || b.status !== 'booked')
        fail(400, 'Отменить можно только активную запись'); run("UPDATE bookings SET status='cancelled' WHERE id=?", b.id); res.json({ ok: true });
}));
app.post('/api/bookings/:id/attendance', permit('admin', 'trainer'), wrap((req, res) => {
    const b = one('SELECT b.*,t.trainer_id,t.starts_at FROM bookings b JOIN trainings t ON t.id=b.training_id WHERE b.id=?', req.params.id); if (!b)
        fail(404, 'Запись не найдена'); if (req.user.role === 'trainer' && b.trainer_id !== req.user.trainer_id)
        fail(403, 'Чужая тренировка'); if (!['attended', 'missed'].includes(req.body.status))
        fail(400, 'Допустимы attended или missed'); db.transaction(() => {
            const current = one('SELECT * FROM bookings WHERE id=?', b.id); if (current.status !== 'booked')
                fail(409, 'Отметка уже сделана или запись отменена'); if (req.body.status === 'attended') {
                    const m = one('SELECT * FROM memberships WHERE id=?', current.membership_id);
                    if (m.remaining <= 0)
                        fail(409, 'Посещения закончились');
                    run('UPDATE memberships SET remaining=remaining-1 WHERE id=?', m.id);
                } run('UPDATE bookings SET status=? WHERE id=?', req.body.status, b.id); syncMemberships();
        })(); res.json({ ok: true });
}));
app.get('/api/reports', permit('admin'), wrap((req, res) => { const from = req.query.from || '2000-01-01', to = req.query.to || '2100-01-01'; res.json({ attendance: q("SELECT substr(t.starts_at,1,10) date,count(*) visits FROM bookings b JOIN trainings t ON t.id=b.training_id WHERE b.status='attended' AND substr(t.starts_at,1,10) BETWEEN ? AND ? GROUP BY date ORDER BY date", from, to), sales: one('SELECT count(*) count,coalesce(sum(p.amount),0) revenue FROM payments p WHERE substr(p.paid_at,1,10) BETWEEN ? AND ?', from, to), load: q("SELECT tr.full_name trainer,count(DISTINCT t.id) trainings,count(b.id) bookings FROM trainers tr LEFT JOIN trainings t ON t.trainer_id=tr.id AND substr(t.starts_at,1,10) BETWEEN ? AND ? LEFT JOIN bookings b ON b.training_id=t.id AND b.status!='cancelled' GROUP BY tr.id", from, to) }); }));
app.get('/api/users', permit('admin'), wrap((req, res) => res.json(q('SELECT u.id,u.username,u.active,u.trainer_id,r.name role FROM users u JOIN roles r ON r.id=u.role_id'))));
app.post('/api/users', permit('admin'), wrap((req, res) => {
    const b = req.body; required(b, ['username', 'password', 'role']); if (b.password.length < 8)
        fail(400, 'Пароль не менее 8 символов'); if (!['admin', 'manager', 'trainer'].includes(b.role))
        fail(400, 'Неверная роль'); if (b.role === 'trainer' && !b.trainer_id)
        fail(400, 'Выберите тренера'); res.json({ id: run('INSERT INTO users(username,password_hash,role_id,trainer_id) VALUES(?,?,(SELECT id FROM roles WHERE name=?),?)', b.username, bcrypt.hashSync(b.password, 12), b.role, b.role === 'trainer' ? b.trainer_id : null).lastInsertRowid });
}));
app.patch('/api/users/:id', permit('admin'), wrap((req, res) => {
    if (Number(req.params.id) === req.user.id && req.body.active === false)
        fail(400, 'Нельзя отключить себя'); const u = one('SELECT * FROM users WHERE id=?', req.params.id); if (!u)
        fail(404, 'Пользователь не найден'); if (req.body.password && req.body.password.length < 8)
        fail(400, 'Пароль не менее 8 символов'); run('UPDATE users SET active=?,password_hash=? WHERE id=?', req.body.active === undefined ? u.active : Number(Boolean(req.body.active)), req.body.password ? bcrypt.hashSync(req.body.password, 12) : u.password_hash, u.id); res.json({ ok: true });
}));
const clientDist = path.resolve(dir, '../client/dist');
if (fs.existsSync(clientDist)) {
    app.use(express.static(clientDist));
    app.get('*', (req, res) => res.sendFile(path.join(clientDist, 'index.html')));
}
app.use((err, req, res, next) => {
    if (err.code?.startsWith('SQLITE_CONSTRAINT'))
        return res.status(409).json({ error: 'Конфликт данных или нарушение ограничений БД' }); res.status(err.status || 500).json({ error: err.status ? err.message : 'Ошибка сервера' }); if (!err.status)
        console.error(err);
});
const port = Number(process.env.PORT || 3000);
app.listen(port, '0.0.0.0', () => console.log(`SportClub: http://localhost:${port}`));
