import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';
const API = '/api';
function App() {
    const [token, setToken] = useState(sessionStorage.getItem('token') || '');
    const [user, setUser] = useState(null);
    const [activeSection, setActiveSection] = useState('trainings');
    const [sectionData, setSectionData] = useState({});
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');
    const [search, setSearch] = useState('');
    const [filter, setFilter] = useState({ date: '', kind: '', trainer_id: '' });
    const [period, setPeriod] = useState({ from: '', to: '' });
    const [editedRecord, setEditedRecord] = useState(null);
    const [login, setLogin] = useState({ username: '', password: '' });
    async function requestApi(path, opts = {}) {
        const r = await fetch(API + path, { ...opts, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...opts.headers } }); const json = await r.json(); if (!r.ok)
            throw Error(json.error || 'Ошибка запроса'); return json;
    }
    async function loadData() {
        if (!token)
            return; try {
                const me = await requestApi('/me');
                setUser(me);
                const endpoints = ['trainings', 'bookings'];
                if (me.role !== 'trainer')
                    endpoints.push('clients', 'memberships', 'types', 'trainers');
                if (me.role === 'admin')
                    endpoints.push('users', 'reports');
                const result = await Promise.all(endpoints.map(async (k) => [k, await requestApi('/' + k)]));
                setSectionData(Object.fromEntries(result));
                setError('');
            }
        catch (e) {
            if (e.message.includes('авторизац'))
                logout();
            else
                setError(e.message);
        }
    }
    useEffect(() => { loadData(); }, [token]);
    function logout() { sessionStorage.removeItem('token'); setToken(''); setUser(null); setActiveSection('trainings'); setSectionData({}); setEditedRecord(null); }
    async function saveOperation(path, body = {}, method = 'POST') {
        try {
            setError('');
            await requestApi(path, { method, body: JSON.stringify(body) });
            setNotice('Изменения сохранены');
            setEditedRecord(null);
            await loadData();
        }
        catch (e) {
            setError(e.message);
        }
    }
    async function signIn(e) {
        e.preventDefault(); try {
            const r = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(login) });
            const j = await r.json();
            if (!r.ok)
                throw Error(j.error);
            sessionStorage.setItem('token', j.token);
            setToken(j.token);
            setError('');
        }
            catch (e) {
                setError(e.message);
            }
    }
    const navigationItems = user?.role === 'trainer' ? [['trainings', 'Расписание'], ['bookings', 'Посещения']] : [['trainings', 'Расписание'], ['clients', 'Клиенты'], ['memberships', 'Абонементы'], ['bookings', 'Записи'], ...(user?.role === 'admin' ? [['trainers', 'Тренеры'], ['types', 'Тарифы'], ['users', 'Сотрудники'], ['reports', 'Отчёты']] : [])];
    const columns = { clients: [['full_name', 'ФИО'], ['phone', 'Телефон'], ['birth_date', 'Дата рождения'], ['status', 'Статус']], trainers: [['full_name', 'ФИО'], ['specialization', 'Направление'], ['phone', 'Телефон']], types: [['name', 'Название'], ['visits', 'Посещения'], ['duration_days', 'Дней'], ['price', 'Цена']], trainings: [['starts_at', 'Дата и время'], ['direction', 'Направление'], ['trainer', 'Тренер'], ['kind', 'Тип'], ['room', 'Зал'], ['occupied', 'Занято'], ['capacity', 'Мест']], memberships: [['client', 'Клиент'], ['type', 'Тариф'], ['start_date', 'Начало'], ['end_date', 'Окончание'], ['remaining', 'Остаток'], ['status', 'Статус']], bookings: [['client', 'Клиент'], ['direction', 'Тренировка'], ['starts_at', 'Дата'], ['status', 'Статус']], users: [['username', 'Логин'], ['role', 'Роль'], ['active', 'Активен']] };
    const getOptions = (key) => sectionData[key] || [];
    const renderField = (name, label, type = 'text', required = true, extra = {}) => <label key={name}>{label}<input name={name} type={type} required={required} defaultValue={editedRecord?.[name] ?? ''} {...extra} /></label>;
    const renderSelect = (name, label, arr, textKey = 'full_name', required = true) => <label key={name}>{label}<select name={name} required={required} defaultValue={editedRecord?.[name] ?? ''}><option value="">Выберите</option>{arr.map(x => <option key={x.id} value={x.id}>{x[textKey]}</option>)}</select></label>;
    const forms = { clients: [renderField('full_name', 'ФИО'), renderField('phone', 'Телефон'), renderField('birth_date', 'Дата рождения', 'date', false), <label key="status">Статус<select name="status" defaultValue={editedRecord?.status || 'active'}><option value="active">Активен</option><option value="inactive">Неактивен</option></select></label>], trainers: [renderField('full_name', 'ФИО'), renderField('specialization', 'Специализация'), renderField('phone', 'Телефон')], types: [renderField('name', 'Название'), renderField('visits', 'Число посещений', 'number', true, { min: 1 }), renderField('duration_days', 'Срок (дни)', 'number', true, { min: 1 }), renderField('price', 'Цена', 'number', true, { min: 0 })], trainings: [renderSelect('trainer_id', 'Тренер', getOptions('trainers')), renderField('starts_at', 'Дата и время', 'datetime-local'), <label key="kind">Тип<select name="kind" defaultValue={editedRecord?.kind || 'group'}><option value="group">Групповая</option><option value="individual">Индивидуальная</option></select></label>, renderField('room', 'Зал'), renderField('capacity', 'Вместимость', 'number', true, { min: 1 }), renderField('direction', 'Направление')], memberships: [renderSelect('client_id', 'Клиент', getOptions('clients')), renderSelect('type_id', 'Тариф', getOptions('types'), 'name'), renderField('start_date', 'Начало', 'date', true, { defaultValue: new Date().toISOString().slice(0, 10) })], bookings: [renderSelect('client_id', 'Клиент', getOptions('clients')), renderSelect('training_id', 'Тренировка', getOptions('trainings'), 'direction')], users: [renderField('username', 'Логин'), renderField('password', 'Пароль', 'password'), <label key="role">Роль<select name="role"><option value="manager">Менеджер</option><option value="trainer">Тренер</option><option value="admin">Администратор</option></select></label>, renderSelect('trainer_id', 'Привязка к тренеру (для роли тренера)', getOptions('trainers'), 'full_name', false)] };
    function submitForm(e) {
        e.preventDefault(); const b = Object.fromEntries(new FormData(e.currentTarget)); for (const k of ['client_id', 'type_id', 'trainer_id', 'training_id', 'visits', 'duration_days', 'capacity', 'price'])
            if (b[k])
                b[k] = Number(b[k]); if (b.trainer_id === '')
            delete b.trainer_id; const id = editedRecord?.id; saveOperation('/' + activeSection + (id ? '/' + id : ''), b, id ? 'PUT' : 'POST');
    }
    const visibleRows = (Array.isArray(sectionData[activeSection]) ? sectionData[activeSection] : []).filter(x => activeSection !== 'clients' || (x.full_name + ' ' + x.phone).toLowerCase().includes(search.toLowerCase())).filter(x => activeSection !== 'trainings' || (!filter.date || x.starts_at.startsWith(filter.date)) && (!filter.kind || x.kind === filter.kind) && (!filter.trainer_id || String(x.trainer_id) === filter.trainer_id));
    if (!token)
        return <main className="login"><form onSubmit={signIn} className="panel"><div className="logo">SPORT/CLUB</div><h1>Вход в систему</h1><p>Управление спортивным клубом</p><label>Логин<input autoComplete="username" value={login.username} onChange={e => setLogin({ ...login, username: e.target.value })} required /></label><label>Пароль<input type="password" autoComplete="current-password" value={login.password} onChange={e => setLogin({ ...login, password: e.target.value })} required /></label><button>Войти</button>{error && <p className="error">{error}</p>}</form></main>;
    return <div className="layout"><aside><div className="logo">SPORT/CLUB</div><small>ATHLETIC SYSTEM / 01</small><nav>{navigationItems.map(([key, title]) => <button key={key} className={activeSection === key ? 'selected' : ''} onClick={() => { setActiveSection(key); setEditedRecord(null); setNotice(''); }}>{title}</button>)}</nav><div className="account">{user?.username} · {({ admin: 'Администратор', manager: 'Менеджер', trainer: 'Тренер' })[user?.role]}<button onClick={logout}>Выйти</button></div></aside><main className="content"><header><div><small>Спортивный клуб / {user?.role}</small><h1>{navigationItems.find(x => x[0] === activeSection)?.[1]}</h1></div><button className="secondary" onClick={loadData}>↻ Обновить</button></header>{error && <div className="error banner">{error}</div>}{notice && <div className="success banner" onClick={() => setNotice('')}>{notice} ×</div>}
        {activeSection === 'reports' ? <div className="panel"><h2>Аналитика клуба</h2><div className="filters"><label>С<input type="date" value={period.from} onChange={e => setPeriod({ ...period, from: e.target.value })} /></label><label>По<input type="date" value={period.to} onChange={e => setPeriod({ ...period, to: e.target.value })} /></label><button onClick={async () => {
            try {
                setSectionData({ ...sectionData, reports: await requestApi(`/reports?from=${period.from || '2000-01-01'}&to=${period.to || '2100-01-01'}`) });
            }
            catch (e) {
                setError(e.message);
            }
        }}>Показать</button></div><div className="stats"><div>Продажи абонементов<strong>{sectionData.reports?.sales?.count || 0}</strong></div><div>Выручка<strong>{sectionData.reports?.sales?.revenue || 0} ₽</strong></div><div>Посещений<strong>{sectionData.reports?.attendance?.reduce((a, b) => a + b.visits, 0) || 0}</strong></div></div><h3>Загрузка тренеров</h3><table><thead><tr><th>Тренер</th><th>Тренировок</th><th>Записей</th></tr></thead><tbody>{sectionData.reports?.load?.map(x => <tr key={x.trainer}><td>{x.trainer}</td><td>{x.trainings}</td><td>{x.bookings}</td></tr>)}</tbody></table><h3>Посещаемость по дням</h3>{sectionData.reports?.attendance?.map(x => <p key={x.date}>{x.date}: {x.visits}</p>)}</div> : <><div className="toolbar">{activeSection === 'clients' && <input placeholder="Поиск по имени или телефону" value={search} onChange={e => setSearch(e.target.value)} />}{activeSection === 'trainings' && <div className="filters"><input type="date" value={filter.date} onChange={e => setFilter({ ...filter, date: e.target.value })} /><select value={filter.kind} onChange={e => setFilter({ ...filter, kind: e.target.value })}><option value="">Все типы</option><option value="group">Групповые</option><option value="individual">Индивидуальные</option></select>{user?.role !== 'trainer' && <select value={filter.trainer_id} onChange={e => setFilter({ ...filter, trainer_id: e.target.value })}><option value="">Все тренеры</option>{getOptions('trainers').map(x => <option value={x.id} key={x.id}>{x.full_name}</option>)}</select>}</div>}{forms[activeSection] && !(user?.role === 'trainer') && !(user?.role === 'manager' && ['trainings', 'trainers', 'types', 'users'].includes(activeSection)) && <button onClick={() => setEditedRecord({ id: null })}>+ Добавить</button>}</div>{['memberships', 'types', 'trainings'].includes(activeSection) && visibleRows.length > 0 && <div className="cardgrid" style={{ marginBottom: 24 }}>{visibleRows.slice(0, 3).map((x, i) => <article className="clubcard" key={x.id}><small>SPORT/CLUB • {String(i + 1).padStart(2, '0')}</small><strong>{x.direction || x.type || x.name}</strong><div>{activeSection === 'trainings' ? `${x.starts_at} / ${x.room}` : activeSection === 'memberships' ? `${x.client} / ${x.remaining} посещ.` : `${x.visits} посещ. / ${x.price} ₽`}</div></article>)}</div>}<div className="section-index">РЕЕСТР / {String(visibleRows.length).padStart(2, "0")} ЗАПИСЕЙ</div><div className="panel tablewrap"><table><thead><tr>{columns[activeSection]?.map(([k, label]) => <th key={k}>{label}</th>)}<th>Действия</th></tr></thead><tbody>{visibleRows.map(x => <tr key={x.id}>{columns[activeSection]?.map(([k]) => <td key={k}>{k === 'active' ? (x[k] ? 'Да' : 'Нет') : k === 'kind' ? (x[k] === 'group' ? 'Групповая' : 'Индивидуальная') : String(k === 'status' ? ({ active: 'Активен', inactive: 'Неактивен', frozen: 'Заморожен', expired: 'Истёк', closed: 'Закрыт', booked: 'Записан', attended: 'Посетил', missed: 'Не пришёл', cancelled: 'Отменён' })[x[k]] || x[k] : x[k] ?? '—')}</td>)}<td className="actions">{['clients', 'trainers', 'trainings'].includes(activeSection) && !(user?.role === 'trainer') && !(user?.role === 'manager' && activeSection !== 'clients') && <button className="tiny" onClick={() => setEditedRecord(x)}>Изменить</button>}{activeSection === 'memberships' && <>{x.status !== 'closed' && <button className="tiny" onClick={() => saveOperation(`/memberships/${x.id}/extend`)}>Продлить</button>}{x.status === 'active' && <button className="tiny" onClick={() => saveOperation(`/memberships/${x.id}/freeze`)}>Заморозить</button>}{x.status === 'frozen' && <button className="tiny" onClick={() => saveOperation(`/memberships/${x.id}/unfreeze`)}>Разморозить</button>}{x.status !== 'closed' && <button className="tiny" onClick={() => saveOperation(`/memberships/${x.id}/close`)}>Закрыть</button>}</>}{activeSection === 'bookings' && x.status === 'booked' && <>{user?.role !== 'trainer' && <button className="tiny" onClick={() => saveOperation(`/bookings/${x.id}/cancel`)}>Отменить</button>}{user?.role !== 'manager' && <><button className="tiny" onClick={() => saveOperation(`/bookings/${x.id}/attendance`, { status: 'attended' })}>Посетил</button><button className="tiny" onClick={() => saveOperation(`/bookings/${x.id}/attendance`, { status: 'missed' })}>Не пришёл</button></>}</>}{activeSection === 'users' && <button className="tiny" onClick={() => saveOperation(`/users/${x.id}`, { active: !x.active }, 'PATCH')}>{x.active ? 'Отключить' : 'Включить'}</button>}</td></tr>)}</tbody></table>{!visibleRows.length && <p className="empty">Записей пока нет</p>}</div></>}
        {editedRecord && <div className="overlay" onClick={() => setEditedRecord(null)}><div className="modal panel" onClick={e => e.stopPropagation()}><div className="modalhead"><h2>{editedRecord.id ? 'Редактирование' : 'Добавление'}</h2><button className="secondary" onClick={() => setEditedRecord(null)}>✕</button></div><form onSubmit={submitForm} className="form">{forms[activeSection]}<button>Сохранить</button></form></div></div>}</main></div>;
}
createRoot(document.getElementById('root')).render(<App />);
