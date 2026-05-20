(function () {
  "use strict";

  var STORAGE_KEYS = {
    stations: "le-mie-radio:stations",
    current: "le-mie-radio:current-station"
  };

  var RADIO_BROWSER_ENDPOINTS = [
    "https://de1.api.radio-browser.info/json/stations/search",
    "https://nl1.api.radio-browser.info/json/stations/search",
    "https://at1.api.radio-browser.info/json/stations/search"
  ];
  var AUDIO_FADE_MS = 650;
  var AUDIO_TARGET_VOLUME = 1;

  var state = {
    stations: [],
    currentStation: null,
    editingId: null,
    storageAvailable: true,
    storageCorrupted: false,
    messageTimer: null,
    searchTimer: null,
    searchRequestId: 0,
    playbackStatus: "idle",
    fadeTimer: null,
    pauseIntent: "",
    interruptedWhilePlaying: false,
    resumeTimer: null
  };

  var els = {};

  document.addEventListener("DOMContentLoaded", init);

  function init() {
    cacheElements();
    state.storageAvailable = storageWorks();
    state.stations = getStations();
    bindEvents();
    renderStations();
    restoreCurrentStation();
    updateFormMode();
    registerServiceWorker();

    if (!state.storageAvailable) {
      showMessage("Il browser non permette il salvataggio locale. Puoi usare l'app, ma i dati potrebbero sparire alla chiusura.", "warning", true);
    } else if (state.storageCorrupted) {
      showMessage("I dati salvati nel browser non sono leggibili. Puoi importare un backup o cancellare i dati del sito dal browser.", "warning", true);
    }
  }

  function cacheElements() {
    els.message = document.getElementById("message");
    els.stationList = document.getElementById("stationList");
    els.tabButtons = Array.prototype.slice.call(document.querySelectorAll("[data-tab]"));
    els.tabPanels = Array.prototype.slice.call(document.querySelectorAll("[data-tab-panel]"));

    els.stationForm = document.getElementById("stationForm");
    els.stationName = document.getElementById("stationName");
    els.stationStream = document.getElementById("stationStream");
    els.stationLogo = document.getElementById("stationLogo");
    els.stationNotes = document.getElementById("stationNotes");
    els.formError = document.getElementById("formError");
    els.testPlayBtn = document.getElementById("testPlayBtn");
    els.saveStationBtn = document.getElementById("saveStationBtn");
    els.clearFormBtn = document.getElementById("clearFormBtn");
    els.cancelEditBtn = document.getElementById("cancelEditBtn");
    els.deleteEditBtn = document.getElementById("deleteEditBtn");
    els.addTitle = document.getElementById("add-title");
    els.addSubtitle = document.getElementById("add-subtitle");

    els.searchForm = document.getElementById("searchForm");
    els.searchQuery = document.getElementById("searchQuery");
    els.searchStatus = document.getElementById("searchStatus");
    els.searchResults = document.getElementById("searchResults");

    els.exportJsonBtn = document.getElementById("exportJsonBtn");
    els.importJsonBtn = document.getElementById("importJsonBtn");
    els.importFile = document.getElementById("importFile");

    els.playerBar = document.querySelector(".player-bar");
    els.playerLogo = document.getElementById("playerLogo");
    els.playerTitle = document.getElementById("playerTitle");
    els.audio = document.getElementById("audioPlayer");
    els.playerError = document.getElementById("playerError");
    els.playerToggleButton = document.getElementById("playerToggleButton");
    els.playerToggleIcon = document.getElementById("playerToggleIcon");
    els.stopButton = document.getElementById("stopButton");
  }

  function bindEvents() {
    els.tabButtons.forEach(function (button) {
      button.addEventListener("click", function () {
        setActiveTab(button.dataset.tab);
      });
    });

    els.stationForm.addEventListener("submit", handleStationSubmit);
    els.testPlayBtn.addEventListener("click", handleTestPlay);
    els.clearFormBtn.addEventListener("click", clearFormFields);
    els.cancelEditBtn.addEventListener("click", cancelEdit);
    els.deleteEditBtn.addEventListener("click", handleDeleteFromEdit);

    els.searchForm.addEventListener("submit", handleSearchSubmit);
    els.searchQuery.addEventListener("input", handleSearchInput);
    els.exportJsonBtn.addEventListener("click", exportStationsJson);
    els.importJsonBtn.addEventListener("click", function () {
      els.importFile.click();
    });
    els.importFile.addEventListener("change", handleImportFile);

    els.playerToggleButton.addEventListener("click", handlePlayerToggle);
    els.stopButton.addEventListener("click", function () {
      stopPlayer(true, { fade: true, intent: "stop" });
      showMessage("Riproduzione fermata.", "success");
    });

    els.audio.addEventListener("play", function () {
      state.pauseIntent = "";
      state.interruptedWhilePlaying = false;
      setPlaybackStatus("loading");
    });
    els.audio.addEventListener("playing", function () {
      setPlaybackStatus("playing");
      fadeMediaVolume(AUDIO_TARGET_VOLUME, AUDIO_FADE_MS);
      updateMediaSessionPlaybackState("playing");
    });
    els.audio.addEventListener("pause", function () {
      if (state.currentStation && state.playbackStatus !== "idle" && state.playbackStatus !== "error") {
        if (!state.pauseIntent && (state.playbackStatus === "playing" || state.playbackStatus === "loading")) {
          state.interruptedWhilePlaying = true;
        }
        setPlaybackStatus("paused");
        updateMediaSessionPlaybackState("paused");
      }
      state.pauseIntent = "";
    });
    els.audio.addEventListener("waiting", function () {
      if (state.currentStation) {
        setPlaybackStatus("loading");
      }
    });
    els.audio.addEventListener("stalled", function () {
      if (state.currentStation) {
        setPlaybackStatus("loading");
      }
    });
    els.audio.addEventListener("canplay", function () {
      if (state.currentStation && state.playbackStatus === "loading" && els.audio.paused) {
        setPlaybackStatus("ready");
      }
    });
    els.audio.addEventListener("error", function () {
      if (state.currentStation) {
        setPlaybackStatus("error");
        updateMediaSessionPlaybackState("none");
        showPlayerError("Non riesco a riprodurre questa radio. Lo stream potrebbe non essere compatibile con il browser.");
      }
    });

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("focus", handlePossibleResume);
    window.addEventListener("pageshow", handlePossibleResume);
    window.addEventListener("online", handlePossibleResume);
  }

  function storageWorks() {
    try {
      var key = "le-mie-radio:storage-test";
      window.localStorage.setItem(key, "1");
      window.localStorage.removeItem(key);
      return true;
    } catch (error) {
      return false;
    }
  }

  function getStations() {
    if (!state.storageAvailable) {
      return [];
    }

    try {
      var raw = window.localStorage.getItem(STORAGE_KEYS.stations);
      if (!raw) {
        return [];
      }

      var parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        state.storageCorrupted = true;
        return [];
      }

      return parsed.reduce(function (stations, item) {
        var station = sanitizeStation(item);
        if (station) {
          stations.push(station);
        }
        return stations;
      }, []);
    } catch (error) {
      state.storageCorrupted = true;
      return [];
    }
  }

  function saveStations(stations) {
    if (!state.storageAvailable) {
      return false;
    }

    try {
      window.localStorage.setItem(STORAGE_KEYS.stations, JSON.stringify(stations));
      return true;
    } catch (error) {
      showMessage("Non riesco a salvare nel browser. Lo spazio locale potrebbe essere pieno o bloccato.", "error", true);
      return false;
    }
  }

  function saveCurrentStation(station) {
    if (!state.storageAvailable) {
      return;
    }

    try {
      if (!station) {
        window.localStorage.removeItem(STORAGE_KEYS.current);
      } else {
        window.localStorage.setItem(STORAGE_KEYS.current, JSON.stringify(station));
      }
    } catch (error) {
      // La radio resta comunque selezionata nella sessione corrente.
    }
  }

  function readCurrentStation() {
    if (!state.storageAvailable) {
      return null;
    }

    try {
      var raw = window.localStorage.getItem(STORAGE_KEYS.current);
      return raw ? sanitizeStation(JSON.parse(raw)) : null;
    } catch (error) {
      return null;
    }
  }

  function addStation(station) {
    var sanitized = sanitizeStation(station);
    if (!sanitized) {
      return false;
    }

    state.stations = [sanitized].concat(state.stations);
    var persisted = saveStations(state.stations);
    renderStations();
    return persisted;
  }

  function updateStation(id, nextStation) {
    var updated = sanitizeStation(Object.assign({}, nextStation, { id: id }));
    if (!updated) {
      return false;
    }

    state.stations = state.stations.map(function (station) {
      if (station.id === id) {
        return Object.assign({}, updated, {
          createdAt: station.createdAt || updated.createdAt
        });
      }
      return station;
    });

    if (state.currentStation && state.currentStation.id === id) {
      state.currentStation = state.stations.find(function (station) {
        return station.id === id;
      });
      saveCurrentStation(state.currentStation);
      selectStation(state.currentStation, false);
    }

    var persisted = saveStations(state.stations);
    renderStations();
    return persisted;
  }

  function deleteStation(id) {
    var station = state.stations.find(function (item) {
      return item.id === id;
    });

    if (!station) {
      return;
    }

    state.stations = state.stations.filter(function (item) {
      return item.id !== id;
    });
    saveStations(state.stations);

    if (state.currentStation && sameStationOrUrl(state.currentStation, station)) {
      stopPlayer(true);
    }

    renderStations();
  }

  function findDuplicateByUrl(streamUrl, ignoreId) {
    var normalized = normalizeUrl(streamUrl).toLowerCase();
    return state.stations.find(function (station) {
      return station.id !== ignoreId && normalizeUrl(station.streamUrl).toLowerCase() === normalized;
    });
  }

  function sanitizeStation(input) {
    if (!input || typeof input !== "object") {
      return null;
    }

    var streamUrl = normalizeUrl(input.streamUrl || input.url || input.url_resolved);
    if (!isValidHttpUrl(streamUrl)) {
      return null;
    }

    var logoUrl = normalizeUrl(input.logoUrl || input.favicon || "");
    if (logoUrl && !isValidHttpUrl(logoUrl)) {
      logoUrl = "";
    }

    var name = cleanText(input.name);
    if (!name) {
      name = generateNameFromUrl(streamUrl);
    }

    return {
      id: cleanText(input.id) || createStationId(),
      name: name,
      streamUrl: streamUrl,
      logoUrl: logoUrl,
      notes: cleanText(input.notes),
      createdAt: isValidDate(input.createdAt) ? input.createdAt : new Date().toISOString()
    };
  }

  function createStationId() {
    var random = Math.random().toString(36).slice(2, 8);
    return "station-" + Date.now() + "-" + random;
  }

  function cleanText(value) {
    return String(value || "").trim();
  }

  function normalizeUrl(value) {
    return String(value || "").trim();
  }

  function isValidHttpUrl(value) {
    var url = normalizeUrl(value);
    if (!/^https?:\/\//i.test(url)) {
      return false;
    }

    try {
      var parsed = new URL(url);
      return parsed.protocol === "http:" || parsed.protocol === "https:";
    } catch (error) {
      return false;
    }
  }

  function isValidDate(value) {
    return Boolean(value && !Number.isNaN(Date.parse(value)));
  }

  function generateNameFromUrl(value) {
    var fallback = "Radio senza nome";
    try {
      var parsed = new URL(normalizeUrl(value));
      var parts = parsed.pathname.split("/").filter(Boolean);
      var source = parts.length ? parts[parts.length - 1] : parsed.hostname;
      source = decodeURIComponent(source);
      source = source.replace(/\.[a-z0-9]{2,5}$/i, "");
      source = source.replace(/^www\./i, "");
      source = source.replace(/[-_+.]+/g, " ");
      source = source.replace(/\s+/g, " ").trim();

      if (!source || /^(stream|listen|live|radio)$/i.test(source)) {
        source = parsed.hostname.replace(/^www\./i, "").split(".")[0];
      }

      return titleCase(source || fallback);
    } catch (error) {
      return fallback;
    }
  }

  function titleCase(value) {
    return String(value)
      .toLowerCase()
      .replace(/\b[\w\u00c0-\u017f]/g, function (letter) {
        return letter.toUpperCase();
      });
  }

  function setActiveTab(tabName) {
    document.body.classList.toggle("search-active", tabName === "search");

    els.tabPanels.forEach(function (panel) {
      panel.hidden = panel.dataset.tabPanel !== tabName;
    });

    els.tabButtons.forEach(function (button) {
      var isActive = button.dataset.tab === tabName;
      button.classList.toggle("is-active", isActive);
      if (isActive) {
        button.setAttribute("aria-current", "page");
      } else {
        button.removeAttribute("aria-current");
      }
    });

    if (tabName === "radio") {
      renderStations();
    }

    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function renderStations() {
    clearElement(els.stationList);

    if (!state.stations.length) {
      els.stationList.appendChild(renderEmptyState());
      return;
    }

    state.stations.forEach(function (station) {
      els.stationList.appendChild(createStationCard(station, "saved"));
    });
  }

  function renderEmptyState() {
    var card = createElement("div", "empty-card");
    var title = createElement("h2", "", "Non hai ancora radio salvate");
    var text = createElement("p", "", "Vai su Aggiungi per incollare un URL oppure su Cerca per trovarne una.");
    var actions = createElement("div", "empty-actions");
    var addButton = createElement("button", "button button-primary", "Aggiungi radio");
    var searchButton = createElement("button", "button button-secondary", "Cerca radio");

    addButton.type = "button";
    searchButton.type = "button";
    addButton.addEventListener("click", function () {
      setActiveTab("add");
      els.stationStream.focus();
    });
    searchButton.addEventListener("click", function () {
      setActiveTab("search");
      els.searchQuery.focus();
    });

    actions.appendChild(addButton);
    actions.appendChild(searchButton);
    card.appendChild(title);
    card.appendChild(text);
    card.appendChild(actions);
    return card;
  }

  function createStationCard(station, source) {
    if (source === "saved") {
      return createSavedStationCard(station);
    }

    var card = createElement("article", "station-card");
    var logo = createLogo(station.name, station.logoUrl, "station-logo");
    var main = createElement("div", "station-main");
    var title = createElement("h2", "station-title", station.name || "Radio senza nome");
    var meta = createElement("p", "station-meta", stationMetaText(station, source));
    var actions = createElement("div", "station-actions");
    var playButton = createElement("button", "button button-primary", "Play");

    playButton.type = "button";
    playButton.addEventListener("click", function () {
      playStation(station);
    });

    card.appendChild(logo);
    main.appendChild(title);
    main.appendChild(meta);

    if (station.notes) {
      main.appendChild(createElement("p", "station-notes", station.notes));
    }

    actions.appendChild(playButton);

    var saveButton = createElement("button", "button button-secondary", "Salva");
    saveButton.type = "button";
    saveButton.addEventListener("click", function () {
      saveSearchResult(station);
    });
    actions.appendChild(saveButton);

    main.appendChild(actions);
    card.appendChild(main);
    return card;
  }

  function createSavedStationCard(station) {
    var card = createElement("article", "station-card saved-station-card");
    var logo = createLogo(station.name, station.logoUrl, "station-logo station-logo-list");
    var title = createElement("h2", "station-title", station.name || "Radio senza nome");
    var actions = createElement("div", "station-actions");
    var playButton = createElement("button", "button saved-icon-button saved-play-button", "");
    var playIcon = createElement("span", "", "▶");
    var editButton = createElement("button", "button saved-icon-button saved-edit-button", "");
    var editIcon = createElement("span", "", "✎");

    playButton.type = "button";
    playButton.title = "Play";
    playButton.setAttribute("aria-label", "Play " + (station.name || "questa radio"));
    playButton.addEventListener("click", function () {
      playStation(station);
    });

    editButton.type = "button";
    editButton.title = "Modifica";
    editButton.setAttribute("aria-label", "Modifica " + (station.name || "questa radio"));
    editButton.addEventListener("click", function () {
      startEdit(station.id);
    });

    playIcon.setAttribute("aria-hidden", "true");
    editIcon.setAttribute("aria-hidden", "true");
    playButton.appendChild(playIcon);
    editButton.appendChild(editIcon);
    actions.appendChild(playButton);
    actions.appendChild(editButton);
    card.appendChild(logo);
    card.appendChild(title);
    card.appendChild(actions);
    return card;
  }

  function stationMetaText(station, source) {
    if (source === "search") {
      var parts = [];
      if (station.country) {
        parts.push(station.country);
      }
      if (station.codec) {
        parts.push(station.codec);
      }
      if (station.bitrate) {
        parts.push(station.bitrate + " kbps");
      }
      return parts.length ? parts.join(" · ") : "Informazioni non disponibili";
    }

    return station.streamUrl;
  }

  function createDetails(summaryText, bodyText) {
    var details = createElement("details", "station-details");
    var summary = createElement("summary", "", summaryText);
    var code = createElement("code", "", bodyText);
    details.appendChild(summary);
    details.appendChild(code);
    return details;
  }

  function createLogo(name, logoUrl, className) {
    var logo = createElement("div", className || "station-logo");
    var fallback = createElement("span", "", initialFromName(name));
    logo.appendChild(fallback);

    if (logoUrl && isValidHttpUrl(logoUrl)) {
      var img = document.createElement("img");
      img.alt = "";
      img.loading = "lazy";
      img.src = logoUrl;
      img.addEventListener("error", function () {
        img.remove();
      });
      logo.appendChild(img);
    }

    return logo;
  }

  function initialFromName(name) {
    var text = cleanText(name);
    return text ? text.charAt(0).toUpperCase() : "R";
  }

  function formatDate(value) {
    if (!isValidDate(value)) {
      return "data non disponibile";
    }

    return new Intl.DateTimeFormat("it-IT", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric"
    }).format(new Date(value));
  }

  function handleStationSubmit(event) {
    event.preventDefault();
    hideFormError();

    var formStation = readStationForm();
    if (!formStation) {
      return;
    }

    var duplicate = findDuplicateByUrl(formStation.streamUrl, state.editingId);
    if (duplicate) {
      showFormError("Esiste già una radio salvata con lo stesso URL stream.");
      return;
    }

    if (state.editingId) {
      updateStation(state.editingId, formStation);
      showMessage("Modifiche salvate.", "success");
      cancelEdit();
      setActiveTab("radio");
      return;
    }

    var persisted = addStation(formStation);
    clearFormFields();
    setActiveTab("radio");
    showMessage(persisted ? "Radio salvata." : "Radio aggiunta solo per questa sessione: il salvataggio locale non è disponibile.", persisted ? "success" : "warning");
  }

  function readStationForm() {
    var streamUrl = normalizeUrl(els.stationStream.value);
    var logoUrl = normalizeUrl(els.stationLogo.value);
    var name = cleanText(els.stationName.value);

    if (!streamUrl) {
      showFormError("Inserisci l'URL dello stream audio.");
      els.stationStream.focus();
      return null;
    }

    if (!isValidHttpUrl(streamUrl)) {
      showFormError("L'URL stream deve iniziare con http:// o https:// ed essere un URL valido.");
      els.stationStream.focus();
      return null;
    }

    if (logoUrl && !isValidHttpUrl(logoUrl)) {
      showFormError("L'URL logo deve iniziare con http:// o https://.");
      els.stationLogo.focus();
      return null;
    }

    return {
      id: state.editingId || createStationId(),
      name: name || generateNameFromUrl(streamUrl),
      streamUrl: streamUrl,
      logoUrl: logoUrl,
      notes: cleanText(els.stationNotes.value),
      createdAt: new Date().toISOString()
    };
  }

  function handleTestPlay() {
    hideFormError();
    var station = readStationForm();
    if (!station) {
      return;
    }

    playStation(Object.assign({}, station, { id: "test-" + Date.now() }));
    showMessage("Test avviato. Se non senti audio, lo stream potrebbe non essere diretto o compatibile.", "warning");
  }

  function clearFormFields() {
    els.stationForm.reset();
    hideFormError();
  }

  function startEdit(id) {
    var station = state.stations.find(function (item) {
      return item.id === id;
    });

    if (!station) {
      showMessage("Radio non trovata.", "error");
      return;
    }

    state.editingId = id;
    els.stationName.value = station.name;
    els.stationStream.value = station.streamUrl;
    els.stationLogo.value = station.logoUrl;
    els.stationNotes.value = station.notes;
    updateFormMode();
    setActiveTab("add");
    els.stationName.focus();
  }

  function cancelEdit() {
    state.editingId = null;
    clearFormFields();
    updateFormMode();
  }

  function updateFormMode() {
    var editing = Boolean(state.editingId);
    els.addTitle.textContent = editing ? "Modifica radio" : "Aggiungi radio";
    els.addSubtitle.textContent = editing ? "Aggiorna i dati della radio salvata" : "Incolla l'URL dello stream e salva la radio";
    els.saveStationBtn.textContent = editing ? "Salva modifiche" : "Salva radio";
    els.cancelEditBtn.hidden = !editing;
    els.deleteEditBtn.hidden = !editing;
  }

  function handleDeleteFromEdit() {
    if (!state.editingId) {
      return;
    }

    var station = state.stations.find(function (item) {
      return item.id === state.editingId;
    });

    if (!station) {
      showMessage("Radio non trovata.", "error");
      return;
    }

    if (confirmDelete(station)) {
      cancelEdit();
      setActiveTab("radio");
    }
  }

  function confirmDelete(station) {
    var ok = window.confirm('Eliminare "' + station.name + '" dalla lista?');
    if (!ok) {
      return false;
    }

    deleteStation(station.id);
    showMessage("Radio eliminata.", "success");
    return true;
  }

  async function handleSearchSubmit(event) {
    event.preventDefault();
    window.clearTimeout(state.searchTimer);
    performSearch(cleanText(els.searchQuery.value), true);
  }

  function handleSearchInput() {
    var query = cleanText(els.searchQuery.value);
    state.searchRequestId += 1;

    if (!query) {
      window.clearTimeout(state.searchTimer);
      clearElement(els.searchResults);
      setSearchStatus("");
      return;
    }

    if (query.length < 2) {
      window.clearTimeout(state.searchTimer);
      clearElement(els.searchResults);
      setSearchStatus("Continua a scrivere per cercare.");
      return;
    }

    window.clearTimeout(state.searchTimer);
    state.searchTimer = window.setTimeout(function () {
      performSearch(query, false);
    }, 450);
  }

  async function performSearch(query, focusIfEmpty) {
    var requestId = state.searchRequestId + 1;
    state.searchRequestId = requestId;

    if (!query) {
      setSearchStatus("Scrivi il nome di una radio o un genere da cercare.");
      if (focusIfEmpty) {
        els.searchQuery.focus();
      }
      return;
    }

    if (query.length < 2) {
      setSearchStatus("Scrivi almeno 2 caratteri per cercare.");
      return;
    }

    clearElement(els.searchResults);
    setSearchStatus("Cerco radio...");

    try {
      var results = await searchRadioBrowser(query);
      if (requestId !== state.searchRequestId) {
        return;
      }
      renderSearchResults(results);
    } catch (error) {
      if (requestId !== state.searchRequestId) {
        return;
      }
      clearElement(els.searchResults);
      setSearchStatus("Non riesco a raggiungere Radio Browser. Puoi comunque aggiungere una radio manualmente.");
    }
  }

  async function searchRadioBrowser(query) {
    var params = new URLSearchParams({
      name: query,
      limit: "24",
      hidebroken: "true",
      order: "clickcount",
      reverse: "true"
    });

    var lastError = null;
    for (var i = 0; i < RADIO_BROWSER_ENDPOINTS.length; i += 1) {
      try {
        var response = await fetchWithTimeout(RADIO_BROWSER_ENDPOINTS[i] + "?" + params.toString(), 12000);
        if (!response.ok) {
          throw new Error("HTTP " + response.status);
        }

        var data = await response.json();
        if (!Array.isArray(data)) {
          throw new Error("Formato risposta non valido");
        }

        return data.map(mapRadioBrowserResult).filter(Boolean);
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError || new Error("Radio Browser non raggiungibile");
  }

  function fetchWithTimeout(url, timeout) {
    var controller = window.AbortController ? new AbortController() : null;
    var timer = controller ? window.setTimeout(function () {
      controller.abort();
    }, timeout) : null;

    var request = fetch(url, {
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: controller ? controller.signal : undefined
    });

    function clearTimer() {
      if (timer) {
        window.clearTimeout(timer);
      }
    }

    return request.then(function (response) {
      clearTimer();
      return response;
    }, function (error) {
      clearTimer();
      throw error;
    });
  }

  function mapRadioBrowserResult(item) {
    var streamUrl = normalizeUrl(item.url_resolved || item.url);
    if (!isValidHttpUrl(streamUrl)) {
      return null;
    }

    return {
      id: item.stationuuid ? "radio-browser-" + item.stationuuid : createStationId(),
      name: cleanText(item.name) || generateNameFromUrl(streamUrl),
      streamUrl: streamUrl,
      logoUrl: isValidHttpUrl(item.favicon) ? normalizeUrl(item.favicon) : "",
      notes: "",
      createdAt: new Date().toISOString(),
      country: cleanText(item.country),
      codec: cleanText(item.codec),
      bitrate: Number(item.bitrate) > 0 ? Number(item.bitrate) : ""
    };
  }

  function renderSearchResults(results) {
    clearElement(els.searchResults);

    if (!results.length) {
      setSearchStatus("Nessun risultato valido. Prova con un nome più generico.");
      return;
    }

    setSearchStatus(results.length + " risultati trovati.");
    results.forEach(function (station) {
      els.searchResults.appendChild(createStationCard(station, "search"));
    });
  }

  function saveSearchResult(station) {
    if (findDuplicateByUrl(station.streamUrl)) {
      showMessage("Questa radio è già nei preferiti.", "warning");
      return;
    }

    var persisted = addStation({
      name: station.name,
      streamUrl: station.streamUrl,
      logoUrl: station.logoUrl,
      notes: station.country ? "Trovata su Radio Browser - " + station.country : "Trovata su Radio Browser",
      createdAt: new Date().toISOString()
    });

    showMessage(persisted ? "Radio salvata nei preferiti." : "Radio aggiunta solo per questa sessione: il salvataggio locale non è disponibile.", persisted ? "success" : "warning");
  }

  function setSearchStatus(message) {
    els.searchStatus.textContent = message || "";
  }

  function playStation(station) {
    var sanitized = sanitizeStation(station);
    if (!sanitized) {
      showMessage("Questa radio non ha un URL stream valido.", "error");
      return;
    }

    if (isLikelyMixedContent(sanitized.streamUrl)) {
      showMessage("Questo stream usa HTTP e potrebbe essere bloccato dal browser quando l'app è pubblicata in HTTPS.", "warning", true);
    }

    var same = state.currentStation && sameStationOrUrl(state.currentStation, sanitized);
    if (same && !els.audio.paused) {
      highlightPlayer();
      return;
    }

    selectStation(sanitized, true);
  }

  function selectStation(station, shouldPlay) {
    state.currentStation = station;
    saveCurrentStation(station);
    renderPlayer();

    var streamUrl = normalizeUrl(station.streamUrl);
    if (els.audio.dataset.streamUrl !== streamUrl) {
      els.audio.src = streamUrl;
      els.audio.dataset.streamUrl = streamUrl;
    }

    if (shouldPlay) {
      playCurrentStation();
    } else {
      setPlaybackStatus("ready");
    }

    highlightPlayer();
  }

  function playCurrentStation() {
    if (!state.currentStation) {
      showMessage("Scegli prima una radio.", "warning");
      return;
    }

    if (!els.audio.src && state.currentStation.streamUrl) {
      els.audio.src = normalizeUrl(state.currentStation.streamUrl);
      els.audio.dataset.streamUrl = normalizeUrl(state.currentStation.streamUrl);
    }

    hidePlayerError();
    state.pauseIntent = "";
    state.interruptedWhilePlaying = false;
    setMediaVolume(0);
    updateMediaSessionMetadata();
    setPlaybackStatus("loading");
    var playPromise = els.audio.play();
    if (playPromise && typeof playPromise.catch === "function") {
      playPromise.catch(function () {
        setMediaVolume(AUDIO_TARGET_VOLUME);
        setPlaybackStatus("paused");
        showPlayerError("L'audio non è partito. Tocca Play nel player o verifica che lo stream sia compatibile.");
      });
    }
  }

  function handlePlayerToggle() {
    if (!state.currentStation || state.playbackStatus === "loading") {
      return;
    }

    if (els.audio.paused) {
      playCurrentStation();
      return;
    }

    pauseCurrentStation({ fade: true, intent: "user" });
  }

  function pauseCurrentStation(options) {
    var opts = options || {};
    state.pauseIntent = opts.intent || "user";
    state.interruptedWhilePlaying = false;

    var finishPause = function () {
      try {
        els.audio.pause();
      } catch (error) {
        // Ignora errori del player nativo.
      }
      setPlaybackStatus("paused");
      updateMediaSessionPlaybackState("paused");
      setMediaVolume(AUDIO_TARGET_VOLUME);
    };

    if (opts.fade) {
      fadeMediaVolume(0, AUDIO_FADE_MS, finishPause);
    } else {
      finishPause();
    }
  }

  function renderPlayer() {
    clearElement(els.playerLogo);
    hidePlayerError();

    if (!state.currentStation) {
      document.body.classList.remove("has-player");
      els.playerLogo.appendChild(createElement("span", "", "-"));
      els.playerTitle.textContent = "Nessuna radio selezionata";
      els.audio.hidden = true;
      els.playerToggleButton.disabled = true;
      els.stopButton.hidden = true;
      setPlaybackStatus("idle");
      return;
    }

    document.body.classList.add("has-player");
    var logo = createLogo(state.currentStation.name, state.currentStation.logoUrl, "station-logo station-logo-small");
    while (logo.firstChild) {
      els.playerLogo.appendChild(logo.firstChild);
    }
    els.playerTitle.textContent = state.currentStation.name;
    els.audio.hidden = false;
    els.playerToggleButton.disabled = false;
    els.stopButton.hidden = false;
    updatePlayerButton();
  }

  function restoreCurrentStation() {
    var saved = readCurrentStation();
    if (!saved) {
      renderPlayer();
      return;
    }

    var matchingSavedStation = state.stations.find(function (station) {
      return sameStationOrUrl(station, saved);
    });

    selectStation(matchingSavedStation || saved, false);
  }

  function stopPlayer(clearCurrent, options) {
    var opts = options || {};
    state.pauseIntent = opts.intent || "stop";
    state.interruptedWhilePlaying = false;

    var finishStop = function () {
      try {
        els.audio.pause();
      } catch (error) {
        // Ignora errori del player nativo.
      }

      els.audio.removeAttribute("src");
      els.audio.dataset.streamUrl = "";
      els.audio.load();
      setMediaVolume(AUDIO_TARGET_VOLUME);
      setPlaybackStatus("idle");
      updateMediaSessionPlaybackState("none");

      if (clearCurrent) {
        state.currentStation = null;
        saveCurrentStation(null);
        renderPlayer();
      }
    };

    if (opts.fade && !els.audio.paused) {
      fadeMediaVolume(0, AUDIO_FADE_MS, finishStop);
    } else {
      finishStop();
    }
  }

  function showPlayerError(message) {
    els.playerError.textContent = message;
    els.playerError.hidden = false;
    showMessage(message, "error");
  }

  function hidePlayerError() {
    els.playerError.textContent = "";
    els.playerError.hidden = true;
  }

  function setPlaybackStatus(status) {
    state.playbackStatus = status;
    updatePlayerButton();
  }

  function setMediaVolume(value) {
    try {
      els.audio.volume = Math.max(0, Math.min(AUDIO_TARGET_VOLUME, value));
    } catch (error) {
      // iOS puo' ignorare il controllo volume via JavaScript.
    }
  }

  function fadeMediaVolume(target, duration, done) {
    window.clearInterval(state.fadeTimer);

    var start = typeof els.audio.volume === "number" ? els.audio.volume : AUDIO_TARGET_VOLUME;
    var targetVolume = Math.max(0, Math.min(AUDIO_TARGET_VOLUME, target));
    var startedAt = Date.now();

    if (duration <= 0 || Math.abs(start - targetVolume) < 0.01) {
      setMediaVolume(targetVolume);
      if (typeof done === "function") {
        done();
      }
      return;
    }

    state.fadeTimer = window.setInterval(function () {
      var progress = Math.min(1, (Date.now() - startedAt) / duration);
      var nextVolume = start + (targetVolume - start) * progress;
      setMediaVolume(nextVolume);

      if (progress >= 1) {
        window.clearInterval(state.fadeTimer);
        state.fadeTimer = null;
        setMediaVolume(targetVolume);
        if (typeof done === "function") {
          done();
        }
      }
    }, 40);
  }

  function handleVisibilityChange() {
    // Non fermiamo l'audio quando l'app va in background: serve per Maps, blocco schermo e PWA.
    if (!document.hidden) {
      handlePossibleResume();
    }
  }

  function handlePossibleResume() {
    if (!state.currentStation || !state.interruptedWhilePlaying || !els.audio.paused) {
      return;
    }

    window.clearTimeout(state.resumeTimer);
    state.resumeTimer = window.setTimeout(function () {
      if (state.interruptedWhilePlaying && state.currentStation && els.audio.paused) {
        playCurrentStation();
      }
    }, 500);
  }

  function updateMediaSessionMetadata() {
    if (!("mediaSession" in navigator) || !state.currentStation) {
      return;
    }

    try {
      if ("MediaMetadata" in window) {
        var artwork = [];
        if (state.currentStation.logoUrl) {
          artwork.push({ src: state.currentStation.logoUrl });
        }

        navigator.mediaSession.metadata = new MediaMetadata({
          title: state.currentStation.name,
          artist: "Le mie radio",
          album: "Web radio",
          artwork: artwork
        });
      }

      navigator.mediaSession.setActionHandler("play", function () {
        playCurrentStation();
      });
      navigator.mediaSession.setActionHandler("pause", function () {
        pauseCurrentStation({ fade: true, intent: "user" });
      });
      navigator.mediaSession.setActionHandler("stop", function () {
        stopPlayer(true, { fade: true, intent: "stop" });
      });
    } catch (error) {
      // Media Session non e' disponibile ovunque.
    }
  }

  function updateMediaSessionPlaybackState(value) {
    if (!("mediaSession" in navigator)) {
      return;
    }

    try {
      navigator.mediaSession.playbackState = value;
    } catch (error) {
      // Alcuni browser espongono solo parte della Media Session API.
    }
  }

  function updatePlayerButton() {
    if (!els.playerToggleButton || !els.playerToggleIcon) {
      return;
    }

    els.playerToggleButton.classList.toggle("is-loading", state.playbackStatus === "loading");

    if (!state.currentStation) {
      els.playerToggleIcon.textContent = "▶";
      els.playerToggleButton.setAttribute("aria-label", "Play");
      return;
    }

    if (state.playbackStatus === "loading") {
      els.playerToggleIcon.textContent = "";
      els.playerToggleButton.setAttribute("aria-label", "Caricamento " + state.currentStation.name);
      return;
    }

    if (!els.audio.paused && state.playbackStatus === "playing") {
      els.playerToggleIcon.textContent = "Ⅱ";
      els.playerToggleButton.setAttribute("aria-label", "Pausa " + state.currentStation.name);
      return;
    }

    els.playerToggleIcon.textContent = "▶";
    els.playerToggleButton.setAttribute("aria-label", "Play " + state.currentStation.name);
  }

  function highlightPlayer() {
    els.playerBar.classList.remove("is-highlighted");
    window.setTimeout(function () {
      els.playerBar.classList.add("is-highlighted");
    }, 20);
  }

  function sameStationOrUrl(a, b) {
    if (!a || !b) {
      return false;
    }

    return a.id === b.id || normalizeUrl(a.streamUrl).toLowerCase() === normalizeUrl(b.streamUrl).toLowerCase();
  }

  function isLikelyMixedContent(streamUrl) {
    return window.location.protocol === "https:" && /^http:\/\//i.test(streamUrl);
  }

  function exportStationsJson() {
    var payload = {
      version: 1,
      exportedAt: new Date().toISOString(),
      stations: state.stations
    };

    var blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    var url = URL.createObjectURL(blob);
    var link = document.createElement("a");
    link.href = url;
    link.download = "mie-radio.json";
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 1000);
    showMessage("File JSON generato. Puoi condividerlo o salvarlo sul dispositivo.", "success");
  }

  function handleImportFile(event) {
    var file = event.target.files && event.target.files[0];
    if (!file) {
      return;
    }

    var reader = new FileReader();
    reader.onload = function () {
      importStationsFromText(String(reader.result || ""));
      els.importFile.value = "";
    };
    reader.onerror = function () {
      showMessage("Non riesco a leggere il file selezionato.", "error");
      els.importFile.value = "";
    };
    reader.readAsText(file);
  }

  function importStationsFromText(text) {
    var parsed;
    try {
      parsed = JSON.parse(cleanText(text));
    } catch (error) {
      showMessage("JSON non valido. Controlla di aver incollato tutto il contenuto del file.", "error");
      return;
    }

    var incoming = Array.isArray(parsed) ? parsed : parsed && Array.isArray(parsed.stations) ? parsed.stations : null;
    if (!incoming) {
      showMessage("Formato JSON non riconosciuto. Usa un array di radio o un oggetto con proprietà stations.", "error");
      return;
    }

    var summary = mergeImportedStations(incoming);
    renderStations();
    setActiveTab("radio");
    showMessage("Import completato: " + summary.imported + " importate, " + summary.duplicates + " duplicate saltate, " + summary.invalid + " non valide ignorate.", "success", true);
  }

  function mergeImportedStations(incoming) {
    var summary = { imported: 0, duplicates: 0, invalid: 0 };
    var knownUrls = new Set(state.stations.map(function (station) {
      return normalizeUrl(station.streamUrl).toLowerCase();
    }));
    var validStations = [];

    incoming.forEach(function (item) {
      var station = sanitizeStation(item);
      if (!station) {
        summary.invalid += 1;
        return;
      }

      var normalizedUrl = normalizeUrl(station.streamUrl).toLowerCase();
      if (knownUrls.has(normalizedUrl)) {
        summary.duplicates += 1;
        return;
      }

      knownUrls.add(normalizedUrl);
      validStations.push(station);
      summary.imported += 1;
    });

    if (validStations.length) {
      state.stations = validStations.concat(state.stations);
      saveStations(state.stations);
    }

    return summary;
  }

  function resetLocalData() {
    var ok = window.confirm("Cancellare tutte le radio salvate e l'ultima radio selezionata da questo browser?");
    if (!ok) {
      return;
    }

    state.stations = [];
    state.currentStation = null;
    state.editingId = null;

    if (state.storageAvailable) {
      try {
        window.localStorage.removeItem(STORAGE_KEYS.stations);
        window.localStorage.removeItem(STORAGE_KEYS.current);
      } catch (error) {
        // La UI viene comunque aggiornata.
      }
    }

    stopPlayer(true);
    cancelEdit();
    clearElement(els.searchResults);
    setSearchStatus("");
    renderStations();
    showMessage("Dati locali cancellati.", "success");
  }

  function showFormError(message) {
    els.formError.textContent = message;
    els.formError.hidden = false;
  }

  function hideFormError() {
    els.formError.textContent = "";
    els.formError.hidden = true;
  }

  function showMessage(message, type, persist) {
    window.clearTimeout(state.messageTimer);
    els.message.textContent = message;
    els.message.className = "message message-" + (type || "info");
    els.message.hidden = false;

    if (!persist) {
      state.messageTimer = window.setTimeout(function () {
        els.message.hidden = true;
      }, 5200);
    }
  }

  function createElement(tagName, className, text) {
    var element = document.createElement(tagName);
    if (className) {
      element.className = className;
    }
    if (typeof text === "string") {
      element.textContent = text;
    }
    return element;
  }

  function clearElement(element) {
    while (element.firstChild) {
      element.removeChild(element.firstChild);
    }
  }

  function registerServiceWorker() {
    if (!("serviceWorker" in navigator) || window.location.protocol === "file:") {
      return;
    }

    window.addEventListener("load", function () {
      navigator.serviceWorker.register("./service-worker.js")
        .then(function (registration) {
          registration.update();
        })
        .catch(function () {
          // L'app resta utilizzabile anche senza service worker.
        });
    });
  }
})();
