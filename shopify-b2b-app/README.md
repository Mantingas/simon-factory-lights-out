# B2B rekvizitai — Shopify Checkout UI Extension

Checkout blokas, kuris pagal įmonės arba PVM kodą suranda įmonės rekvizitus ir
išsaugo juos prie užsakymo.

Duomenų šaltinis: `https://b2b-company-api-production.up.railway.app`

---

## ⚠️ Vienas apribojimas, kurį reikia žinoti prieš pradedant

**Checkout UI plėtinys negali įrašyti sąskaitos (billing) adreso.** Tai Shopify
platformos apribojimas, ne šio kodo trūkumas. Patikrinta prieš
`@shopify/ui-extensions@2025.1.3`:

| | |
|---|---|
| `billingAddress` | `StatefulRemoteSubscribable<MailingAddress>` — **tik skaitymui** |
| `applyBillingAddressChange` | **neegzistuoja** visame API |
| `useApplyShippingAddressChange` | egzistuoja — bet pristatymo adreso keisti nevalia |

Todėl rasti rekvizitai saugomi į **note attributes**, kurie keliauja kartu su
užsakymu:

```
Invoice_Company_Name    Mažoji bendrija Taste lovers
Invoice_Company_Code    305666952
Invoice_VAT_Code        LT100013612410
Invoice_Address         Vilnius, Perkūnkiemio g. 19, LT-12120
```

`Invoice_Address` pridėtas papildomai — be jo adresas, kurį radome, niekur
nepatektų.

### Kaip iš tikrųjų užpildyti sąskaitos adresą

Trys keliai, nuo paprasčiausio:

1. **Palikti kaip yra.** Rekvizitai matomi užsakyme ir Admin sąsajoje; sąskaitą
   išrašantis asmuo ar apskaitos integracija juos perskaito iš atributų.
   Daugumai parduotuvių to pakanka.
2. **Atnaujinti užsakymą po checkout.** Programėlės backend'as užsiprenumeruoja
   `orders/create` webhook'ą ir per Admin API (`orderUpdate`) įrašo billing
   adresą iš atributų. Tai vienintelis būdas realiai užpildyti lauką.
3. **Shopify B2B** (Plus planas). Ten rekvizitai kyla iš Company Location
   objekto, ir šis plėtinys tampa nereikalingas.

---

## Failų medis

```
shopify-b2b-app/
├── shopify.app.toml                 programėlės konfigūracija
├── package.json                     CLI + testai
└── extensions/b2b-checkout-lookup/
    ├── shopify.extension.toml       target, network_access, nustatymai
    ├── package.json                 @shopify/ui-extensions(-react), react
    ├── tsconfig.json
    ├── src/
    │   ├── Checkout.tsx             komponentas
    │   ├── api.ts                   API klientas ir rezultatų tipai
    │   └── normalize.ts             kodų valymas, šalių logika
    ├── locales/
    │   ├── lt.default.json          numatytoji kalba
    │   └── en.json
    └── tests/                       51 testas
```

## Paleidimas

```bash
npm install
cd extensions/b2b-checkout-lookup && npm install && cd ../..

npx shopify app config link     # užpildo client_id
npm run dev
```

Plėtinys **nepasirodys savaime**: `purchase.checkout.block.render` yra
perkeliamas blokas. Checkout redaktoriuje jį reikia įdėti į norimą vietą
(rekomenduojama — po adreso forma).

```bash
npm test          # 51 testas, be interneto
npm run typecheck # prieš tikrus Shopify tipus
npm run deploy
```

## Kaip veikia

1. Pirkėjas pažymi „Perku kaip įmonė / juridinis asmuo“
2. Pasirenka šalį — numatytoji imama iš checkout, jei ji tarp LT, PL, LV, EE
3. Įveda kodą; tarpai, taškai, brūkšneliai ir `LT`/`PL`/`LV`/`EE` prefiksas
   nuvalomi automatiškai, o po lauku parodoma, ko bus ieškoma
4. Paspaudus „Rasti įmonę“ kviečiamas `GET /api/v1/company/:country/:code`
5. Radus — žalias pranešimas su rekvizitais, atributai išsaugomi
6. Neradus — švelnus pranešimas: *„Įmonė nerasta. Prašome rekvizitus sąskaitai
   suvesti rankiniu būdu.“*

Paieška vyksta **mygtuko paspaudimu**, ne rašant. Taip išvengiama dešimčių
užklausų vienam kodui ir kvotos išnaudojimo.

## Klaidų atskyrimas

Atskiri pranešimai skirtingiems atvejams — nes pasakyti „įmonė nerasta“, kai
neveikia servisas, siųstų žmogų ieškoti klaidos, kurios jis nepadarė.

| Atvejis | Pranešimas |
|---|---|
| `404` | Įmonė nerasta → suveskite rankiniu būdu |
| `400`, `422` | tas pats — kodas netinkamas |
| `429` | Per daug užklausų |
| `5xx`, tinklo klaida, timeout | Paieška laikinai neveikia |

Papildomai: jei registras rodo įmonę **išregistruotą**, parodomas raudonas
įspėjimas su data — verta žinoti prieš išrašant sąskaitą, ne po.

## API raktas ir kvotos

Plėtinys veikia naršyklėje, todėl **bet koks jame įrašytas API raktas būtų
viešas**. Dėl to naudojamas anoniminis lygis: 20 užklausų per parą **vienam
pirkėjo IP**, o ne visai parduotuvei — realiam pirkėjui to su kaupu užtenka.

Jei prireiktų daugiau, raktą reikia laikyti backend'e ir kviesti API per jį, o
ne per plėtinį.

Kad tai veiktų, API turi leisti CORS iš checkout domeno — dabartinė
konfigūracija (`origin: "*"`, `GET`, `OPTIONS`) tai daro.

## Nustatymai checkout redaktoriuje

| Laukas | Kam |
|---|---|
| `api_base_url` | Nukreipti į staging API nekeičiant plėtinio. Tuščias = numatytasis |

## `network_access`

`shopify.extension.toml` nurodo `network_access = true`. Viešoms programėlėms
Shopify šią teisę **peržiūri** ir klausia, į kokį hostą kreipiamasi ir kodėl.
Atsakymas: `b2b-company-api-production.up.railway.app`, viešų įmonių registrų
(Registrų centras, VMI, VIES, GUS) duomenims gauti. Asmens duomenys nesiunčiami
— tik įmonės kodas.

## Kas nepatikrinta

Kodas patikrintas `tsc` prieš tikrus `@shopify/ui-extensions@2025.1.3` tipus, o
gryna logika padengta 51 testu. **Bet plėtinys nebuvo paleistas realioje
parduotuvėje** — nebuvo prieigos prie Shopify dev store. Prieš diegiant į
produkciją būtina `npm run dev` su tikru checkout.
