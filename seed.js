const { getDb, hashPassword } = require("./db");

const ASSIGNMENT_ROLES = [
  "Serveringsansvarig",
  "Kontakt Krögare",
  "Providör Ansvarig",
  "Övrig Providör",
  "Rigga",
  "Röja",
];

const CHECKLIST_TEMPLATE = [
  ["Inför Loge", "Hämta antal anmälda + avvikelser från Sek/ÖSek", "OP / delegat", "Direkt efter deadline"],
  ["Inför Loge", "Maila krögaren (inkl. meny, antal, avvikelser)", "OP / delegat", "Snarast efter deadline"],
  ["Inför Loge", "Genomför inventering — uppdatera Lagerlistan", "OP + P", "Senast 2 dagar före"],
  ["Inför Loge", "Sammanställ inköpslista (se Lagerlista.xlsx)", "OP + P", "Senast 2 dagar före"],
  ["Inför Loge", "Genomför inköp", "OP / P", "Senast 2 tim. före"],
  ["Inför Loge", "Ställ in varor i barskåp/kyl", "OP / P", "Senast 2 tim. före"],
  ["Inför Loge", "Kontrollera att alkohol är inlåst", "OP", "Vid inköp"],
  ["Kvällsstart", "Ladda iPad och iZettle — kontrollera funktion", "P", "2 tim. före"],
  ["Kvällsstart", "Rodda barkylen — fyll på dricka, kontrollera temp", "P", "2 tim. före"],
  ["Kvällsstart", "Rodda källarbar: glas, öppnare, lotter, lottvinster", "P", "Senast 1 tim. före"],
  ["Kvällsstart", "Serveringsansvarig anlänt och bekräftat närvaro", "OP", "Innan öppning"],
  ["Kvällsstart", "Baren öppnar — OK ges av serveringsansvarig", "Serveringsansv.", "Vid logéstart"],
  ["Avslut & Efterstädning", "Stäng baren — gemensamt beslut med serveringsansvarig", "P + Serveringsansv.", "Kvällens slut"],
  ["Avslut & Efterstädning", "Plocka all disk i diskbackar", "P", "Vid stängning"],
  ["Avslut & Efterstädning", "Bär diskbackar till diskrummet — diska om >1 full back", "P", "Vid stängning"],
  ["Avslut & Efterstädning", "Bär upp allt tomglas — ställ vid köksingång", "P", "Vid stängning"],
  ["Avslut & Efterstädning", "Ställ i ordning bord och stolar nere i källaren", "P", "Innan hemgång"],
  ["Avslut & Efterstädning", "Matsalsbaren återställd och undanplockad", "P", "Innan hemgång"],
  ["Dagen efter", "Sopa alla ytor (bar uppe, bar nere, foajé)", "P", "Senast 12:00"],
  ["Dagen efter", "Töm papperskorgar (barer, foajé, toaletter)", "P", "Senast 12:00"],
  ["Dagen efter", "Sortera och kasta tomglas i soprum", "P", "Senast 12:00"],
  ["Dagen efter", "Uppdatera Lagerlistan efter kvällen", "OP + P", "Senast 12:00"],
];

const INVENTORY = [
  ["Cognac", "Grönstedts VS", 1.2, "flaskor"],
  ["Cognac", "Martell VS", 0, "flaskor"],
  ["Cognac", "Hennessy VS", 0, "flaskor"],
  ["Cola & Läsk", "Cola", 4, "burkar"],
  ["Cola & Läsk", "Fanta", 20, "burkar"],
  ["Cola & Läsk", "Grape", 3, "burkar"],
  ["Cola & Läsk", "Schweppes 1,5 L", 2.5, "flaskor"],
  ["Gin", "Gin", 4.5, "flaskor"],
  ["Guinness", "Guinness", 2, "burkar"],
  ["Punsch", "Punsch", 2.5, "flaskor"],
  ["Snaps", "Bitter", 2, "flaskor"],
  ["Snaps", "Gammel Dansk", 1, "flaskor"],
  ["Snaps", "OP Andersson", 0, "flaskor"],
  ["Snaps", "Skåne", 1, "flaskor"],
  ["Snaps", "Vodka", 0, "flaskor"],
  ["Snaps", "Piratens Besk", 1, "flaskor"],
  ["Vin", "Rött", 19, "flaskor"],
  ["Vin", "Rött 0%", 5, "flaskor"],
  ["Vin", "Vitt", 3, "flaskor"],
  ["Vin", "Vitt 0%", 6, "flaskor"],
  ["Whisky", "Ardbeg", 1, "flaskor"],
  ["Whisky", "Famous Grouse", 3, "flaskor"],
  ["Whisky", "Glenfiddich", 1, "flaskor"],
  ["Whisky", "Laphroaig", 1.2, "flaskor"],
  ["Öl", "Carlsberg", 0, "burkar"],
  ["Öl", "Mariestad", 13, "burkar"],
  ["Öl", "Moretti", 24, "burkar"],
  ["Öl", "Peroni", 0, "burkar"],
  ["Öl", "Mellerud", 40, "burkar"],
  ["Öl", "Carlsberg 0%", 8, "burkar"],
  ["Tonic", "Tonic Water 200ml", 23, "flaskor"],
  ["Kraken", "Kraken", 1.5, "flaskor"],
  ["Rom", "C M (Rom)", 0.5, "flaskor"],
  ["Glögg", "Glögg", 4, "flaskor"],
];

function seedDatabase() {
  const db = getDb();

  const existing = db.prepare("SELECT COUNT(*) as count FROM users").get();
  if (existing.count > 0) return;

  const insertUser = db.prepare(
    "INSERT INTO users (username, display_name, password_hash, role) VALUES (?, ?, ?, ?)"
  );
  const insertMeeting = db.prepare(
    "INSERT INTO meetings (date, grad) VALUES (?, ?)"
  );
  const insertAssignment = db.prepare(
    "INSERT INTO assignments (meeting_id, user_id, role) VALUES (?, ?, ?)"
  );
  const insertChecklist = db.prepare(
    "INSERT INTO checklist_items (meeting_id, phase, description, responsible, time_when) VALUES (?, ?, ?, ?, ?)"
  );
  const insertInventory = db.prepare(
    "INSERT INTO inventory (category, name, stock, unit) VALUES (?, ?, ?, ?)"
  );

  const seedTx = db.transaction(() => {
    // Users
    const users = [
      ["op", "Ordens Providör", hashPassword("op123"), "OP"],
      ["p1", "Providör 1", hashPassword("p1123"), "P"],
      ["p2", "Providör 2", hashPassword("p2123"), "P"],
      ["cm", "Ceremonimästare", hashPassword("cm123"), "CM"],
      ["ocm", "Över-CM", hashPassword("ocm123"), "ÖCM"],
      ["sek", "Sekreterare", hashPassword("sek123"), "Sek"],
      ["osek", "Översekreterare", hashPassword("osek123"), "ÖSek"],
      ["medlem1", "Erik Svensson", hashPassword("medlem123"), "Medlem"],
      ["medlem2", "Lars Johansson", hashPassword("medlem123"), "Medlem"],
    ];
    const userIds = {};
    for (const [username, display, hash, role] of users) {
      const result = insertUser.run(username, display, hash, role);
      userIds[username] = result.lastInsertRowid;
    }

    // Meetings
    const meetingsData = [
      ["2026-02-21", "I+HD"],
      ["2026-03-12", "IV"],
      ["2026-04-09", "B-Afton"],
      ["2026-05-07", "II"],
      ["2026-05-30", "VIII"],
      ["2026-06-13", "F-Fest"],
    ];
    for (const [date, grad] of meetingsData) {
      const m = insertMeeting.run(date, grad);
      const meetingId = m.lastInsertRowid;

      // Assignments
      for (const role of ASSIGNMENT_ROLES) {
        const userId = role === "Kontakt Krögare" ? userIds["op"] : null;
        insertAssignment.run(meetingId, userId, role);
      }

      // Checklist
      for (const [phase, desc, responsible, when] of CHECKLIST_TEMPLATE) {
        insertChecklist.run(meetingId, phase, desc, responsible, when);
      }
    }

    // Inventory
    for (const [cat, name, stock, unit] of INVENTORY) {
      insertInventory.run(cat, name, stock, unit);
    }
  });

  seedTx();
  console.log("Database seeded!");
}

module.exports = { seedDatabase, ASSIGNMENT_ROLES };
