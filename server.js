const express = require("express");
const session = require("express-session");
const SQLiteStore = require("connect-sqlite3")(session);
const path = require("path");

const { initDb, getDb, hashPassword, verifyPassword } = require("./db");
const { seedDatabase, ASSIGNMENT_ROLES } = require("./seed");

const app = express();
const PORT = process.env.PORT || 3000;

// --- Middleware ---
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));
app.use(
  session({
    store: new SQLiteStore({ db: "sessions.db", dir: __dirname }),
    secret: process.env.SESSION_SECRET || "w6-dev-key-change-in-prod",
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 },
  })
);

// Make user available in all templates
app.use((req, res, next) => {
  res.locals.currentUser = req.session.user || null;
  res.locals.flash = req.session.flash || null;
  req.session.flash = null;
  next();
});

function flash(req, msg, type = "success") {
  req.session.flash = { message: msg, type };
}

function requireLogin(req, res, next) {
  if (!req.session.user) return res.redirect("/login");
  next();
}

// --- Helper: format date for display ---
const MONTHS_SV = ["jan", "feb", "mar", "apr", "maj", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];
function formatDate(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  return `${d.getDate()} ${MONTHS_SV[d.getMonth()]} ${d.getFullYear()}`;
}
function formatDateShort(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  return `${d.getDate()} ${MONTHS_SV[d.getMonth()]}`;
}
app.locals.formatDate = formatDate;
app.locals.formatDateShort = formatDateShort;
app.locals.ASSIGNMENT_ROLES = ASSIGNMENT_ROLES;

// ── Auth ─────────────────────────────────────────────

app.get("/login", (req, res) => {
  if (req.session.user) return res.redirect("/");
  res.render("login");
});

app.post("/login", (req, res) => {
  const db = getDb();
  const user = db.prepare("SELECT * FROM users WHERE username = ?").get(req.body.username);
  if (user && verifyPassword(req.body.password, user.password_hash)) {
    req.session.user = { id: user.id, username: user.username, display_name: user.display_name, role: user.role };
    return res.redirect("/");
  }
  flash(req, "Fel användarnamn eller lösenord.", "danger");
  res.redirect("/login");
});

app.get("/register", (req, res) => res.render("register"));

app.post("/register", (req, res) => {
  const db = getDb();
  const { username, display_name, password } = req.body;
  if (!username || !display_name || !password) {
    flash(req, "Alla fält måste fyllas i.", "danger");
    return res.redirect("/register");
  }
  const existing = db.prepare("SELECT id FROM users WHERE username = ?").get(username.trim());
  if (existing) {
    flash(req, "Användarnamnet är upptaget.", "danger");
    return res.redirect("/register");
  }
  if (password.length < 3) {
    flash(req, "Lösenordet måste vara minst 3 tecken.", "danger");
    return res.redirect("/register");
  }
  const result = db.prepare(
    "INSERT INTO users (username, display_name, password_hash) VALUES (?, ?, ?)"
  ).run(username.trim(), display_name.trim(), hashPassword(password));
  req.session.user = { id: result.lastInsertRowid, username: username.trim(), display_name: display_name.trim(), role: "Medlem" };
  flash(req, `Välkommen ${display_name.trim()}!`, "success");
  res.redirect("/");
});

app.get("/logout", (req, res) => {
  req.session.destroy();
  res.redirect("/login");
});

// ── Dashboard ────────────────────────────────────────

app.get("/", requireLogin, (req, res) => {
  const db = getDb();
  const today = new Date().toISOString().slice(0, 10);
  const upcoming = db.prepare("SELECT * FROM meetings WHERE date >= ? ORDER BY date").all(today);

  const myAssignments = db.prepare(`
    SELECT a.*, m.date, m.grad
    FROM assignments a
    JOIN meetings m ON a.meeting_id = m.id
    WHERE a.user_id = ? AND m.date >= ?
    ORDER BY m.date
  `).all(req.session.user.id, today);

  const pendingSwaps = db.prepare(`
    SELECT sr.*, a.role as assignment_role, a.meeting_id,
           m.date, m.grad, u.display_name as requester_name
    FROM swap_requests sr
    JOIN assignments a ON sr.assignment_id = a.id
    JOIN meetings m ON a.meeting_id = m.id
    JOIN users u ON sr.requester_id = u.id
    WHERE sr.target_id = ? AND sr.status = 'pending'
  `).all(req.session.user.id);

  // Count filled assignments per meeting
  for (const m of upcoming) {
    const counts = db.prepare(
      "SELECT COUNT(*) as total, SUM(CASE WHEN user_id IS NOT NULL THEN 1 ELSE 0 END) as filled FROM assignments WHERE meeting_id = ?"
    ).get(m.id);
    m.total = counts.total;
    m.filled = counts.filled;
  }

  res.render("index", { upcoming, myAssignments, pendingSwaps });
});

// ── Schema ───────────────────────────────────────────

app.get("/schema", requireLogin, (req, res) => {
  const db = getDb();
  const meetings = db.prepare("SELECT * FROM meetings ORDER BY date").all();

  for (const m of meetings) {
    m.assignments = db.prepare(`
      SELECT a.*, u.display_name
      FROM assignments a
      LEFT JOIN users u ON a.user_id = u.id
      WHERE a.meeting_id = ?
    `).all(m.id);
  }

  res.render("schema", { meetings });
});

// ── Meeting detail ───────────────────────────────────

app.get("/meeting/:id", requireLogin, (req, res) => {
  const db = getDb();
  const meeting = db.prepare("SELECT * FROM meetings WHERE id = ?").get(req.params.id);
  if (!meeting) return res.status(404).send("Mötet hittades inte");

  meeting.assignments = db.prepare(`
    SELECT a.*, u.display_name, u.role as user_role
    FROM assignments a
    LEFT JOIN users u ON a.user_id = u.id
    WHERE a.meeting_id = ?
  `).all(meeting.id);

  const users = db.prepare("SELECT id, display_name, role FROM users ORDER BY display_name").all();

  res.render("meeting", { meeting, users });
});

// ── Signup / Assign ──────────────────────────────────

app.post("/signup/:assignmentId", requireLogin, (req, res) => {
  const db = getDb();
  const a = db.prepare("SELECT * FROM assignments WHERE id = ?").get(req.params.assignmentId);
  if (!a) return res.status(404).send("Hittades inte");
  if (a.user_id) {
    flash(req, "Den platsen är redan tagen.", "warning");
  } else {
    db.prepare("UPDATE assignments SET user_id = ? WHERE id = ?").run(req.session.user.id, a.id);
    flash(req, `Du är nu anmäld som ${a.role}!`, "success");
  }
  res.redirect(`/meeting/${a.meeting_id}`);
});

app.post("/unassign/:assignmentId", requireLogin, (req, res) => {
  const db = getDb();
  const a = db.prepare("SELECT * FROM assignments WHERE id = ?").get(req.params.assignmentId);
  if (!a) return res.status(404).send("Hittades inte");
  if (a.user_id !== req.session.user.id && req.session.user.role !== "OP") {
    flash(req, "Du kan bara avanmäla dig själv.", "danger");
  } else {
    db.prepare("UPDATE assignments SET user_id = NULL WHERE id = ?").run(a.id);
    flash(req, "Avanmäld.", "info");
  }
  res.redirect(`/meeting/${a.meeting_id}`);
});

app.post("/assign/:assignmentId", requireLogin, (req, res) => {
  if (req.session.user.role !== "OP") return res.status(403).send("Ej behörig");
  const db = getDb();
  const a = db.prepare("SELECT * FROM assignments WHERE id = ?").get(req.params.assignmentId);
  if (!a) return res.status(404).send("Hittades inte");
  const userId = req.body.user_id ? parseInt(req.body.user_id) : null;
  db.prepare("UPDATE assignments SET user_id = ? WHERE id = ?").run(userId, a.id);
  flash(req, "Uppdaterad.", "success");
  res.redirect(`/meeting/${a.meeting_id}`);
});

// ── Swap requests ────────────────────────────────────

app.get("/swap/request/:assignmentId", requireLogin, (req, res) => {
  const db = getDb();
  const a = db.prepare(`
    SELECT a.*, m.date, m.grad
    FROM assignments a JOIN meetings m ON a.meeting_id = m.id
    WHERE a.id = ?
  `).get(req.params.assignmentId);
  if (!a) return res.status(404).send("Hittades inte");
  if (a.user_id !== req.session.user.id) {
    flash(req, "Du kan bara byta dina egna pass.", "danger");
    return res.redirect(`/meeting/${a.meeting_id}`);
  }
  const users = db.prepare("SELECT id, display_name, role FROM users WHERE id != ? ORDER BY display_name")
    .all(req.session.user.id);
  res.render("swap_request", { assignment: a, users });
});

app.post("/swap/request/:assignmentId", requireLogin, (req, res) => {
  const db = getDb();
  const a = db.prepare("SELECT * FROM assignments WHERE id = ?").get(req.params.assignmentId);
  if (!a || a.user_id !== req.session.user.id) return res.status(403).send("Ej behörig");
  const targetId = req.body.target_id ? parseInt(req.body.target_id) : null;
  db.prepare(
    "INSERT INTO swap_requests (assignment_id, requester_id, target_id, message) VALUES (?, ?, ?, ?)"
  ).run(a.id, req.session.user.id, targetId, req.body.message || "");
  flash(req, "Bytesförfrågan skickad!", "success");
  res.redirect(`/meeting/${a.meeting_id}`);
});

app.post("/swap/respond/:swapId", requireLogin, (req, res) => {
  const db = getDb();
  const sr = db.prepare("SELECT * FROM swap_requests WHERE id = ?").get(req.params.swapId);
  if (!sr) return res.status(404).send("Hittades inte");

  if (req.body.action === "accept") {
    db.prepare("UPDATE assignments SET user_id = ? WHERE id = ?")
      .run(sr.target_id || req.session.user.id, sr.assignment_id);
    db.prepare("UPDATE swap_requests SET status = 'accepted' WHERE id = ?").run(sr.id);
    flash(req, "Byte genomfört!", "success");
  } else if (req.body.action === "take") {
    db.prepare("UPDATE assignments SET user_id = ? WHERE id = ?")
      .run(req.session.user.id, sr.assignment_id);
    db.prepare("UPDATE swap_requests SET target_id = ?, status = 'accepted' WHERE id = ?")
      .run(req.session.user.id, sr.id);
    flash(req, "Du har tagit över passet!", "success");
  } else {
    db.prepare("UPDATE swap_requests SET status = 'declined' WHERE id = ?").run(sr.id);
    flash(req, "Bytesförfrågan nekad.", "info");
  }
  res.redirect("/");
});

app.get("/swaps", requireLogin, (req, res) => {
  const db = getDb();

  const openSwaps = db.prepare(`
    SELECT sr.*, a.role as assignment_role, m.date, m.grad,
           u.display_name as requester_name
    FROM swap_requests sr
    JOIN assignments a ON sr.assignment_id = a.id
    JOIN meetings m ON a.meeting_id = m.id
    JOIN users u ON sr.requester_id = u.id
    WHERE sr.status = 'pending' AND sr.target_id IS NULL
  `).all();

  const myIncoming = db.prepare(`
    SELECT sr.*, a.role as assignment_role, m.date, m.grad,
           u.display_name as requester_name
    FROM swap_requests sr
    JOIN assignments a ON sr.assignment_id = a.id
    JOIN meetings m ON a.meeting_id = m.id
    JOIN users u ON sr.requester_id = u.id
    WHERE sr.target_id = ? AND sr.status = 'pending'
  `).all(req.session.user.id);

  const myOutgoing = db.prepare(`
    SELECT sr.*, a.role as assignment_role, m.date, m.grad,
           t.display_name as target_name
    FROM swap_requests sr
    JOIN assignments a ON sr.assignment_id = a.id
    JOIN meetings m ON a.meeting_id = m.id
    LEFT JOIN users t ON sr.target_id = t.id
    WHERE sr.requester_id = ?
    ORDER BY sr.created_at DESC
  `).all(req.session.user.id);

  res.render("swaps", { openSwaps, myIncoming, myOutgoing });
});

// ── Checklists ───────────────────────────────────────

app.get("/checklist/:meetingId", requireLogin, (req, res) => {
  const db = getDb();
  const meeting = db.prepare("SELECT * FROM meetings WHERE id = ?").get(req.params.meetingId);
  if (!meeting) return res.status(404).send("Mötet hittades inte");

  const items = db.prepare(`
    SELECT ci.*, u.display_name as done_by_name
    FROM checklist_items ci
    LEFT JOIN users u ON ci.done_by_id = u.id
    WHERE ci.meeting_id = ?
  `).all(meeting.id);

  const phases = {};
  for (const item of items) {
    if (!phases[item.phase]) phases[item.phase] = [];
    phases[item.phase].push(item);
  }

  res.render("checklist", { meeting, phases });
});

app.post("/checklist/toggle/:itemId", requireLogin, (req, res) => {
  const db = getDb();
  const item = db.prepare("SELECT * FROM checklist_items WHERE id = ?").get(req.params.itemId);
  if (!item) return res.status(404).send("Hittades inte");
  const newDone = item.done ? 0 : 1;
  const doneBy = newDone ? req.session.user.id : null;
  db.prepare("UPDATE checklist_items SET done = ?, done_by_id = ? WHERE id = ?").run(newDone, doneBy, item.id);
  res.redirect(`/checklist/${item.meeting_id}`);
});

// ── Inventory ────────────────────────────────────────

app.get("/lager", requireLogin, (req, res) => {
  const db = getDb();
  const items = db.prepare("SELECT * FROM inventory ORDER BY category, name").all();
  const categories = {};
  for (const item of items) {
    if (!categories[item.category]) categories[item.category] = [];
    categories[item.category].push(item);
  }
  res.render("inventory", { categories });
});

app.post("/lager/update/:itemId", requireLogin, (req, res) => {
  const db = getDb();
  const stock = parseFloat(req.body.stock);
  if (isNaN(stock)) {
    flash(req, "Ogiltigt värde.", "danger");
  } else {
    db.prepare("UPDATE inventory SET stock = ? WHERE id = ?").run(stock, req.params.itemId);
    flash(req, "Lagersaldo uppdaterat.", "success");
  }
  res.redirect("/lager");
});

// ── Start ────────────────────────────────────────────

initDb();
seedDatabase();

app.listen(PORT, () => {
  console.log(`W:6 Providörsapp körs på http://localhost:${PORT}`);
});
