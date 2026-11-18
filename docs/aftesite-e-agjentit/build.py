"""Raporti "Aftësitë e Agjentit": të dhënat e vlerësimit dhe gjenerimi i faqes.

Ndrysho listat më poshtë kur ndryshon një aftësi në kod, pastaj ekzekuto:
    python3 docs/aftesite-e-agjentit/build.py
Del docs/aftesite-e-agjentit/aftesite-e-agjentit.html (shiko README.md për publikimin).
"""
import html
import os
HERE = os.path.dirname(os.path.abspath(__file__))
Y,P,N="po","pjes","jo"
customer=[
 ("Bisedat",[(Y,"Përgjigje automatike 24/7"),(Y,"Bashkon disa mesazhe të njëpasnjëshme"),(Y,"Postime, reels dhe story të shpërndara: lexon përshkrimin"),(P,"Fotot që dërgon klienti: i ruan për porosinë, por nuk i shikon"),(N,"Mesazhet zanore dhe videot e klientit"),(Y,"Përgjigjet në gjuhën e klientit"),(Y,"Ndalet kur ndërhyn stafi"),(Y,"Reagime me emoji"),(Y,"Kalimi te stafi: automatik kur klienti kërkon një person")]),
 ("Fushatat",[(Y,"Kupton “dua / s'dua oferta”, me evidencë nga mesazhi"),(Y,"Përgjigjet për ofertën e fushatës")]),
 ("Njohuritë",[(Y,"Përgjigje nga njohuritë"),(Y,"Profili i biznesit: orari, adresa, kontakti"),(Y,"“Nuk e di, po të lidh me stafin”: kalim automatik te stafi")]),
 ("Katalogët (PDF)",[(Y,"Përgjigje nga dokumentet"),(Y,"Jep lidhjen e dokumentit"),(P,"Lidh faqen e katalogut me produktin")]),
 ("Klientët",[(Y,"Mban mend emrin, telefonin dhe adresën"),(Y,"Njeh klientin që kthehet"),(P,"Përditëson të dhënat kur klienti i ndryshon")]),
 ("Produktet",[(Y,"Emri, çmimi, detajet, variantet"),(Y,"Numëron, gjen më të lirin dhe më të shtrenjtin"),(Y,"Dërgon foton e produktit"),(Y,"Gjendja e stokut"),(Y,"Njeh produktin nga një postim i shpërndarë"),(P,"Gjen produktin sipas nevojës: vetëm 20 më të përshtatshmit, pa filtër çmimi, jo përtej 1000 produkteve"),(P,"Sugjeron alternativa: vetëm kur produkti ka mbaruar"),(N,"Lidhja drejt faqes së produktit")]),
 ("Leads",[(Y,"Lead-i krijohet vetë nga biseda"),(P,"Cilësimi i interesit të klientit")]),
 ("Kanalet",[(Y,"Instagram"),(Y,"WhatsApp"),(N,"Messenger ose chat në ueb")]),
 ("Shërbimet",[(Y,"Çmimi dhe kohëzgjatja"),(Y,"Lista e shërbimeve"),(P,"Sugjerim sipas nevojës"),(P,"Oraret e lira: vetëm brenda rezervimit"),(N,"Foto e shërbimit")]),
 ("Porositë",[(Y,"Variantet, sasia dhe zgjedhjet"),(Y,"Konfirmimi para porosisë, me përmbledhje të qartë në gjuhën e klientit"),(P,"Kërkon vetëm të dhënat që i duhen porosisë: kërkon qytetin dhe adresën edhe për produkte digjitale, një nga një, përveç kur biznesi i bën opsionale"),(Y,"Kontrolli i stokut nga serveri"),(Y,"Krijimi i porosisë: automatik për produktet aktive me çmim të caktuar ose variant me çmim"),(Y,"Statusi i porosisë: automatik kur Porositë janë të ndezura"),(Y,"Porosia shkon te faqja e biznesit kur ajo është e lidhur"),(N,"Rikthehet te klienti që e la porosinë në mes"),(N,"Ndryshim ose anulim nga klienti"),(N,"Pagesa dhe kostoja e dërgesës")]),
 ("Rezervimet",[(Y,"Konfirmimi para rezervimit"),(P,"Krijimi: automatik, por kërkon kalendarin me leje për Agjentin dhe shërbime që pranojnë rezervime"),(P,"Oraret e lira"),(N,"Anulimi nga klienti"),(N,"Ndryshimi i orës"),(N,"Kujtesa ose statusi i rezervimit")]),
]
business=[
 ("Shërbimet",[(Y,"Krijo dhe ndrysho shërbimin"),(Y,"Oraret dhe cilësimet e kalendarit"),(P,"Fshirja: vetëm çaktivizim")]),
 ("Rezervimet",[(Y,"Krijo rezervim"),(Y,"Ndrysho ose anulo rezervim"),(Y,"Riprovo sinkronizimin"),(Y,"Disponueshmëria"),(Y,"Kërko rezervime"),(N,"Lidhja me Google Calendar")]),
 ("Agjenti",[(Y,"Udhëzimet dhe stili i komunikimit"),(Y,"Menaxhimi i agjentit"),(Y,"Ruaj trajnimin"),(Y,"Ndrysho trajnimin"),(N,"Provë në Chat Lab")]),
 ("Workflow",[(Y,"Lexo workflow-in"),(Y,"Ndërto draftin"),(Y,"Publiko"),(Y,"Ndiz, fik, rikthe"),(N,"Simulimi")]),
 ("Produktet",[(Y,"Krijo produkt"),(Y,"Ndrysho produkt"),(Y,"Arkivo, fshi, rikthe"),(Y,"Konfigurim në grup"),(Y,"Ndrysho një fushë"),(Y,"Numëro dhe krahaso me query në server"),(P,"Importi"),(P,"Foto: vetëm me URL, pa ngarkim"),(N,"Stoku"),(N,"Struktura dhe fushat e produkteve")]),
 ("Raportet dhe Aktiviteti",[(Y,"Përmbledhja e periudhës"),(Y,"Njoftimet për vëmendje"),(Y,"Bisedat e fundit"),(N,"Suksesi i Agjentit në procese")]),
 ("Njohuritë",[(Y,"Shto dhe ndrysho"),(Y,"Fshi"),(N,"Import FAQ nga burime të jashtme")]),
 ("Bisedat",[(Y,"Lexon bisedat e fundit"),(Y,"Ndalo dhe rinis Agjentin në një bisedë"),(Y,"Njoftime për bisedat që presin"),(N,"Dërgo mesazh klientit"),(N,"Reagime")]),
 ("Porositë",[(Y,"Krijo porosi nga biseda"),(Y,"Verifiko porosinë"),(Y,"Kërko porositë"),(Y,"Ndiz porositë për biznesin"),(N,"Ndrysho dërgesën ose shënimin"),(N,"Ndrysho statusin"),(N,"Ndrysho artikujt")]),
 ("Kalendari",[(Y,"Cilësimet e kalendarit"),(N,"Lidhja me Google")]),
 ("Katalogët",[(Y,"I përdor si material"),(N,"Ngarko dokument")]),
 ("Cilësimet",[(Y,"Përgjigjet automatike"),(Y,"Verifikimi i biznesit"),(N,"Modulet"),(N,"Lloji, fushat dhe stoku"),(N,"Integrimet")]),
 ("Klientët",[(Y,"Kërko klientë"),(N,"Ndrysho klientin"),(N,"Fshi klientin")]),
 ("Leads",[(Y,"Numrat te përmbledhja"),(N,"Ndrysho statusin e lead-it"),(N,"Rregullat e lead-eve")]),
 ("Fushatat",[(N,"Krijo dhe dërgo fushatë (vetëm pronari, me konfirmim)")]),
 ("Burimet dhe Onboarding",[(Y,"Pyetjet e profilit të biznesit në bisedë"),(N,"Rifreskon njohuritë nga Instagram-i dhe faqja e biznesit"),(N,"Mëson nga bisedat e vjetra (importi i bisedave)")]),
 ("Integrimet",[(N,"Lidh faqen ose katalogun e jashtëm (kredenciale)")]),
 ("Pagesat dhe Ekipi",[(N,"Abonimi dhe pagesat"),(N,"Anëtarët dhe ftesat")]),
 ("Kanalet",[(N,"Lidh ose shkëput Instagram/WhatsApp (OAuth)")]),
]
score={Y:1,P:.5,N:0}
def pct(items): return round(100*sum(score[s] for s,_ in items)/len(items))
lab={Y:"Po",P:"Pjesërisht",N:"Jo"}
def tier(p): return "hi" if p>=75 else "mid" if p>=50 else "lo"
def section(rows):
    out=[]
    for name,items in sorted(rows,key=lambda r:-pct(r[1])):
        p=pct(items)
        caps="".join(f'<li class="cap {s}"><span class="st">{lab[s]}</span><span>{html.escape(t)}</span></li>' for s,t in items)
        cnt={k:sum(1 for s,_ in items if s==k) for k in (Y,P,N)}
        out.append(f'''<details class="mod" open>
<summary><span class="mname">{html.escape(name)}</span><span class="bar" aria-hidden="true"><span class="fill {tier(p)}" style="width:{p}%"></span></span><span class="pct">{p}%</span><span class="counts">{cnt[Y]} po · {cnt[P]} pjesërisht · {cnt[N]} jo</span></summary>
<ul class="caps">{caps}</ul></details>''')
    return "\n".join(out)
avg=lambda rows: round(sum(pct(i) for _,i in rows)/len(rows))
c_avg=avg(customer); b_avg=avg(business)
b_sec=[r for r in business if r[0] not in ("Fushatat","Kanalet","Integrimet","Pagesat dhe Ekipi")]
b_sec_avg=avg(b_sec)
tpl=open(os.path.join(HERE,"page.tpl.html")).read()
out=tpl.replace("{{C_AVG}}",str(c_avg)).replace("{{B_AVG}}",str(b_avg)).replace("{{B_SEC}}",str(b_sec_avg)).replace("{{CUSTOMER}}",section(customer)).replace("{{BUSINESS}}",section(business)).replace("{{C_N}}",str(len(customer))).replace("{{B_N}}",str(len(business)))
open(os.path.join(HERE,"aftesite-e-agjentit.html"),"w").write(out)
print(c_avg,b_avg,b_sec_avg)
