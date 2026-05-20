# Le mie radio

Piccola web app/PWA statica per salvare e ascoltare web radio personali da iPhone e desktop.

Funziona senza backend, login, database online, API key, tracking, analytics o cookie non necessari. Le radio vengono salvate nel `localStorage` del browser.

## File principali

- `index.html`
- `style.css`
- `app.js`
- `manifest.webmanifest`
- `service-worker.js`
- `icons/icon-192.png`
- `icons/icon-512.png`

## Uso in locale

Puoi aprire `index.html` direttamente nel browser. In questo modo la parte principale dell'app funziona, ma il service worker PWA non viene registrato perché i browser non lo permettono da `file://`.

Per provare anche la PWA, servi la cartella con un piccolo server statico locale e apri l'indirizzo in browser, per esempio `http://localhost:8080`.

## Pubblicazione su GitHub Pages

1. Carica tutti i file del progetto in un repository GitHub.
2. Vai in `Settings` > `Pages`.
3. Scegli il branch da pubblicare, per esempio `main`, e la cartella root.
4. Apri l'URL generato da GitHub Pages, per esempio `https://username.github.io/nome-repo/`.

I percorsi sono relativi, quindi l'app è compatibile con la pubblicazione in sottocartella GitHub Pages.

## Aggiungere la PWA alla schermata Home su iPhone

1. Apri l'app pubblicata con Safari su iPhone.
2. Tocca il pulsante di condivisione.
3. Scegli `Aggiungi alla schermata Home`.
4. Conferma il nome.

Da Home Screen l'app si apre in modalità standalone. L'audio parte solo dopo un tap, come richiesto da iOS.

## Audio in background e interruzioni

L'app non ferma l'audio quando passa in background, quindi una radio già avviata può continuare mentre usi altre app, per esempio Mappe.

Il player usa i controlli multimediali del sistema dove disponibili e prova a gestire le interruzioni in modo morbido: fade in quando parte, fade out su pausa/stop, e ripresa automatica best-effort dopo pause non richieste dall'utente.

Durante telefonate, Siri, notifiche vocali o altre interruzioni, iOS mantiene il controllo finale dell'audio. In alcuni casi potrebbe mettere in pausa lo stream e richiedere un nuovo tap su Play.

## Salvare radio

Nella tab `Aggiungi` incolla l'URL diretto dello stream audio, inserisci un nome se vuoi, poi usa `Test Play` o `Salva radio`.

Se lasci vuoto il nome, l'app prova a generarlo dall'URL. Se una radio con lo stesso URL è già salvata, l'app evita il duplicato.

## Homepage e URL stream

La homepage della radio è una pagina web visitabile, per esempio `https://nomeradio.example`.

L'URL stream è invece l'indirizzo diretto del flusso audio, per esempio un link `.mp3`, `.aac`, `.m3u8` o simile. Il player HTML5 ha bisogno dello stream diretto: incollare solo la homepage spesso non basta.

Alcune radio non funzionano se lo stream non è compatibile con il browser, se risponde lentamente, se usa formati non supportati o se usa `http://` dentro una pagina pubblicata in `https://`.

## Ricerca online

La tab `Cerca` usa la Radio Browser API pubblica per trovare radio online. Non richiede API key.

La ricerca è opzionale: se Radio Browser non risponde o la rete non è disponibile, puoi comunque aggiungere radio manualmente dalla tab `Aggiungi`.

## Import/export

Le radio sono salvate localmente nel singolo browser. Una lista salvata su iPhone non appare automaticamente su Mac o su un altro telefono.

Per trasferire i dati:

- usa `Backup` per scaricare `mie-radio.json`;
- invia il file via AirDrop, iCloud Drive, email, WhatsApp, Telegram, Note o un altro sistema;
- sull'altro dispositivo usa `Importa` e scegli il file JSON.

L'import unisce le radio alla lista esistente. Le radio duplicate, riconosciute dallo stesso `streamUrl`, vengono saltate. Le radio non valide vengono ignorate.

Formato esportato:

```json
{
  "version": 1,
  "exportedAt": "2026-05-20T12:00:00.000Z",
  "stations": [
    {
      "id": "station-1716200000000",
      "name": "Latina Stereo",
      "streamUrl": "https://example.com/stream.mp3",
      "logoUrl": "https://example.com/logo.png",
      "notes": "",
      "createdAt": "2026-05-20T12:00:00.000Z"
    }
  ]
}
```

L'import accetta anche un semplice array JSON di radio.

## Pubblicità negli stream

L'app non contiene pubblicità, tracking o analytics. Eventuali spot interni allo stream della radio vengono trasmessi dalla radio stessa e non possono essere rimossi dall'app.

## Icone

Le icone PNG in `icons/` sono generate localmente come segnaposto semplici. Puoi sostituirle con icone personalizzate mantenendo gli stessi nomi file e dimensioni consigliate.
