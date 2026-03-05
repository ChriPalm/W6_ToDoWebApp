"""Populate the database with initial data from the handbook."""

from datetime import date

from werkzeug.security import generate_password_hash

from models import (
    Assignment,
    ChecklistItem,
    InventoryItem,
    Meeting,
    User,
    db,
)


def seed_all(app):
    with app.app_context():
        if User.query.first():
            return  # already seeded

        # --- Users ---
        users = {
            "op": User(username="op", display_name="Ordens Providör", password_hash=generate_password_hash("op123"), role="OP"),
            "p1": User(username="p1", display_name="Providör 1", password_hash=generate_password_hash("p1123"), role="P"),
            "p2": User(username="p2", display_name="Providör 2", password_hash=generate_password_hash("p2123"), role="P"),
            "cm": User(username="cm", display_name="Ceremonimästare", password_hash=generate_password_hash("cm123"), role="CM"),
            "ocm": User(username="ocm", display_name="Över-CM", password_hash=generate_password_hash("ocm123"), role="ÖCM"),
            "sek": User(username="sek", display_name="Sekreterare", password_hash=generate_password_hash("sek123"), role="Sek"),
            "osek": User(username="osek", display_name="Översekreterare", password_hash=generate_password_hash("osek123"), role="ÖSek"),
            "medlem1": User(username="medlem1", display_name="Erik Svensson", password_hash=generate_password_hash("medlem123"), role="Medlem"),
            "medlem2": User(username="medlem2", display_name="Lars Johansson", password_hash=generate_password_hash("medlem123"), role="Medlem"),
        }
        for u in users.values():
            db.session.add(u)
        db.session.flush()

        # --- Meetings (from schema 2026) ---
        meetings_data = [
            (date(2026, 2, 21), "I+HD"),
            (date(2026, 3, 12), "IV"),
            (date(2026, 4, 9), "B-Afton"),
            (date(2026, 5, 7), "II"),
            (date(2026, 5, 30), "VIII"),
            (date(2026, 6, 13), "F-Fest"),
        ]
        meetings = {}
        for d, grad in meetings_data:
            m = Meeting(date=d, grad=grad)
            db.session.add(m)
            meetings[d] = m
        db.session.flush()

        # --- Assignments (empty slots — to be filled) ---
        for m in meetings.values():
            for role in [
                "Serveringsansvarig",
                "Kontakt Krögare",
                "Providör Ansvarig",
                "Övrig Providör",
                "Rigga",
                "Röja",
            ]:
                a = Assignment(meeting_id=m.id, role=role, user_id=None)
                # pre-fill "Kontakt Krögare" with OP
                if role == "Kontakt Krögare":
                    a.user_id = users["op"].id
                db.session.add(a)

        # --- Checklist templates per meeting ---
        checklist_template = [
            ("Inför Loge", "Hämta antal anmälda + avvikelser från Sek/ÖSek", "OP / delegat", "Direkt efter deadline"),
            ("Inför Loge", "Maila krögaren (inkl. meny, antal, avvikelser)", "OP / delegat", "Snarast efter deadline"),
            ("Inför Loge", "Genomför inventering — uppdatera Lagerlistan", "OP + P", "Senast 2 dagar före"),
            ("Inför Loge", "Sammanställ inköpslista (se Lagerlista.xlsx)", "OP + P", "Senast 2 dagar före"),
            ("Inför Loge", "Genomför inköp", "OP / P", "Senast 2 tim. före"),
            ("Inför Loge", "Ställ in varor i barskåp/kyl", "OP / P", "Senast 2 tim. före"),
            ("Inför Loge", "Kontrollera att alkohol är inlåst", "OP", "Vid inköp"),
            ("Kvällsstart", "Ladda iPad och iZettle — kontrollera funktion", "P", "2 tim. före"),
            ("Kvällsstart", "Rodda barkylen — fyll på dricka, kontrollera temp", "P", "2 tim. före"),
            ("Kvällsstart", "Rodda källarbar: glas, öppnare, lotter, lottvinster", "P", "Senast 1 tim. före"),
            ("Kvällsstart", "Serveringsansvarig anlänt och bekräftat närvaro", "OP", "Innan öppning"),
            ("Kvällsstart", "Baren öppnar — OK ges av serveringsansvarig", "Serveringsansv.", "Vid logéstart"),
            ("Avslut & Efterstädning", "Stäng baren — gemensamt beslut med serveringsansvarig", "P + Serveringsansv.", "Kvällens slut"),
            ("Avslut & Efterstädning", "Plocka all disk i diskbackar", "P", "Vid stängning"),
            ("Avslut & Efterstädning", "Bär diskbackar till diskrummet — diska om >1 full back", "P", "Vid stängning"),
            ("Avslut & Efterstädning", "Bär upp allt tomglas — ställ vid köksingång", "P", "Vid stängning"),
            ("Avslut & Efterstädning", "Ställ i ordning bord och stolar nere i källaren", "P", "Innan hemgång"),
            ("Avslut & Efterstädning", "Matsalsbaren återställd och undanplockad", "P", "Innan hemgång"),
            ("Dagen efter", "Sopa alla ytor (bar uppe, bar nere, foajé)", "P", "Senast 12:00"),
            ("Dagen efter", "Töm papperskorgar (barer, foajé, toaletter)", "P", "Senast 12:00"),
            ("Dagen efter", "Sortera och kasta tomglas i soprum", "P", "Senast 12:00"),
            ("Dagen efter", "Uppdatera Lagerlistan efter kvällen", "OP + P", "Senast 12:00"),
        ]
        for m in meetings.values():
            for phase, desc, responsible, when in checklist_template:
                item = ChecklistItem(
                    meeting_id=m.id,
                    phase=phase,
                    description=desc,
                    responsible=responsible,
                    when=when,
                )
                db.session.add(item)

        # --- Inventory ---
        inventory = [
            ("Cognac", "Grönstedts VS", 1.2, "flaskor"),
            ("Cognac", "Martell VS", 0, "flaskor"),
            ("Cognac", "Hennessy VS", 0, "flaskor"),
            ("Cola & Läsk", "Cola", 4, "burkar"),
            ("Cola & Läsk", "Fanta", 20, "burkar"),
            ("Cola & Läsk", "Grape", 3, "burkar"),
            ("Cola & Läsk", "Schweppes 1,5 L", 2.5, "flaskor"),
            ("Gin", "Gin", 4.5, "flaskor"),
            ("Guinness", "Guinness", 2, "burkar"),
            ("Punsch", "Punsch", 2.5, "flaskor"),
            ("Snaps", "Bitter", 2, "flaskor"),
            ("Snaps", "Gammel Dansk", 1, "flaskor"),
            ("Snaps", "OP Andersson", 0, "flaskor"),
            ("Snaps", "Skåne", 1, "flaskor"),
            ("Snaps", "Vodka", 0, "flaskor"),
            ("Snaps", "Piratens Besk", 1, "flaskor"),
            ("Vin", "Rött", 19, "flaskor"),
            ("Vin", "Rött 0%", 5, "flaskor"),
            ("Vin", "Vitt", 3, "flaskor"),
            ("Vin", "Vitt 0%", 6, "flaskor"),
            ("Whisky", "Ardbeg", 1, "flaskor"),
            ("Whisky", "Famous Grouse", 3, "flaskor"),
            ("Whisky", "Glenfiddich", 1, "flaskor"),
            ("Whisky", "Laphroaig", 1.2, "flaskor"),
            ("Öl", "Carlsberg", 0, "burkar"),
            ("Öl", "Mariestad", 13, "burkar"),
            ("Öl", "Moretti", 24, "burkar"),
            ("Öl", "Peroni", 0, "burkar"),
            ("Öl", "Mellerud", 40, "burkar"),
            ("Öl", "Carlsberg 0%", 8, "burkar"),
            ("Tonic", "Tonic Water 200ml", 23, "flaskor"),
            ("Kraken", "Kraken", 1.5, "flaskor"),
            ("Rom", "C M (Rom)", 0.5, "flaskor"),
            ("Glögg", "Glögg", 4, "flaskor"),
        ]
        for cat, name, stock, unit in inventory:
            db.session.add(InventoryItem(category=cat, name=name, stock=stock, unit=unit))

        db.session.commit()
        print("Database seeded successfully!")
