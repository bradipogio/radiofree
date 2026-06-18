(function () {
  "use strict";

  var APP_VERSION = "20260618-1";

  var STORAGE_KEYS = {
    stations: "le-mie-radio:stations",
    current: "le-mie-radio:current-station"
  };

  var RADIO_BROWSER_ENDPOINTS = [
    "https://de1.api.radio-browser.info/json/stations/search",
    "https://nl1.api.radio-browser.info/json/stations/search",
    "https://at1.api.radio-browser.info/json/stations/search"
  ];
  var RADIO_BROWSER_BASE_URLS = [
    "https://de1.api.radio-browser.info",
    "https://nl1.api.radio-browser.info",
    "https://at1.api.radio-browser.info"
  ];
  var GENRE_TAGS = [
    "00s", "60s", "70s", "80s", "90s",
    "acoustic", "adult contemporary", "alternative", "ambient", "blues",
    "chillout", "christian", "classical", "country", "dance", "disco",
    "easy listening", "electronic", "folk", "funk", "gospel", "hip hop",
    "hits", "house", "indie", "jazz", "latin", "lounge", "metal", "news",
    "oldies", "opera", "pop", "punk", "r&b", "rap", "reggae", "rock",
    "salsa", "smooth jazz", "soul", "soundtrack", "talk", "techno",
    "trance", "world"
  ];
  var SEARCH_RESULT_LIMIT = 100;
  var FILTER_SAMPLE_LIMIT = 500;
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
    filterRequestId: 0,
    playRequestId: 0,
    playbackStatus: "idle",
    fadeTimer: null,
    pauseIntent: "",
    interruptedWhilePlaying: false,
    resumeTimer: null,
    filtersLoaded: false,
    allCountries: [],
    allTags: []
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
    loadSearchFilters();
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

    els.settingsToggle = document.getElementById("settingsToggle");
    els.settingsPanel = document.getElementById("settingsPanel");
    els.settingsAddBtn = document.getElementById("settingsAddBtn");
    els.refreshAppBtn = document.getElementById("refreshAppBtn");

    els.searchForm = document.getElementById("searchForm");
    els.searchQuery = document.getElementById("searchQuery");
    els.searchCountry = document.getElementById("searchCountry");
    els.searchTag = document.getElementById("searchTag");
    els.searchSummary = document.getElementById("searchSummary");
    els.searchStatus = document.getElementById("searchStatus");
    els.searchResults = document.getElementById("searchResults");

    els.exportJsonBtn = document.getElementById("exportJsonBtn");
    els.importJsonBtn = document.getElementById("importJsonBtn");
    els.importFile = document.getElementById("importFile");

    els.playerBar = document.querySelector(".player-bar");
    els.playerLogo = document.getElementById("playerLogo");
    els.playerTitle = document.getElementById("playerTitle");
    els.playerStatus = document.getElementById("playerStatus");
    els.audio = document.getElementById("audioPlayer");
    els.playerError = document.getElementById("playerError");
    els.playerToggleButton = document.getElementById("playerToggleButton");
    els.playerToggleIcon = document.getElementById("playerToggleIcon");
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

    els.settingsToggle.addEventListener("click", toggleSettings);
    els.settingsAddBtn.addEventListener("click", function () {
      closeSettings();
      setActiveTab("add");
      els.stationStream.focus();
    });

    els.searchForm.addEventListener("submit", handleSearchSubmit);
    els.searchQuery.addEventListener("input", handleSearchInput);
    els.searchCountry.addEventListener("change", function () {
      handleFilterChange("country");
    });
    els.searchTag.addEventListener("change", function () {
      handleFilterChange("tag");
    });
    els.exportJsonBtn.addEventListener("click", function () {
      closeSettings();
      exportStationsJson();
    });
    els.importJsonBtn.addEventListener("click", function () {
      els.importFile.click();
      closeSettings();
    });
    els.importFile.addEventListener("change", handleImportFile);
    els.refreshAppBtn.addEventListener("click", refreshApp);

    els.playerToggleButton.addEventListener("click", handlePlayerToggle);
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
      if (state.pauseIntent === "stop") {
        state.pauseIntent = "";
        return;
      }

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
      if (state.currentStation && !els.audio.paused && !state.pauseIntent) {
        setPlaybackStatus("loading");
      }
    });
    els.audio.addEventListener("stalled", function () {
      if (state.currentStation && !els.audio.paused && !state.pauseIntent) {
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
    document.addEventListener("click", handleDocumentClick);
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
          createdAt: station.createdAt || updated.createdAt,
          playCount: safeNumber(station.playCount),
          lastPlayedAt: isValidDate(station.lastPlayedAt) ? station.lastPlayedAt : ""
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
      createdAt: isValidDate(input.createdAt) ? input.createdAt : new Date().toISOString(),
      playCount: safeNumber(input.playCount),
      lastPlayedAt: isValidDate(input.lastPlayedAt) ? input.lastPlayedAt : ""
    };
  }

  function safeNumber(value) {
    var number = Number(value);
    if (!Number.isFinite(number) || number < 0) {
      return 0;
    }
    return Math.floor(number);
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

  function dateValue(value) {
    return isValidDate(value) ? Date.parse(value) : 0;
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
      .replace(/(^|[\s/()[\]-])([^\s/()[\]-])/g, function (match, separator, letter) {
        return separator + letter.toUpperCase();
      });
  }

  function setActiveTab(tabName) {
    closeSettings();
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

  function toggleSettings(event) {
    event.stopPropagation();
    var willOpen = els.settingsPanel.hidden;
    els.settingsPanel.hidden = !willOpen;
    els.settingsToggle.setAttribute("aria-expanded", willOpen ? "true" : "false");
  }

  function closeSettings() {
    if (!els.settingsPanel || els.settingsPanel.hidden) {
      return;
    }

    els.settingsPanel.hidden = true;
    els.settingsToggle.setAttribute("aria-expanded", "false");
  }

  function handleDocumentClick(event) {
    if (!els.settingsPanel || els.settingsPanel.hidden) {
      return;
    }

    if (event.target === els.settingsToggle || els.settingsPanel.contains(event.target)) {
      return;
    }

    closeSettings();
  }

  function renderStations() {
    clearElement(els.stationList);

    if (!state.stations.length) {
      els.stationList.appendChild(renderEmptyState());
      return;
    }

    getStationsForDisplay().forEach(function (station) {
      els.stationList.appendChild(createStationCard(station, "saved"));
    });
  }

  function getStationsForDisplay() {
    return state.stations.slice().sort(function (a, b) {
      var playDelta = safeNumber(b.playCount) - safeNumber(a.playCount);
      if (playDelta !== 0) {
        return playDelta;
      }

      var lastPlayedDelta = dateValue(b.lastPlayedAt) - dateValue(a.lastPlayedAt);
      if (lastPlayedDelta !== 0) {
        return lastPlayedDelta;
      }

      return dateValue(b.createdAt) - dateValue(a.createdAt);
    });
  }

  function renderEmptyState() {
    var card = createElement("div", "empty-card");
    var title = createElement("h2", "", "Non hai ancora radio salvate");
    var text = createElement("p", "", "Usa l'ingranaggio per aggiungere una radio oppure vai su Cerca per trovarne una.");
    var actions = createElement("div", "empty-actions");
    var searchButton = createElement("button", "button button-secondary", "Cerca radio");

    searchButton.type = "button";
    searchButton.addEventListener("click", function () {
      setActiveTab("search");
      els.searchQuery.focus();
    });

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
    var titleRow = createElement("div", "station-title-row");
    var title = createElement("h2", "station-title", station.name || "Radio senza nome");
    var currentBadge = createCurrentBadge();
    var meta = createElement("p", "station-meta", stationMetaText(station, source));
    var actions = createElement("div", "station-actions");
    var playButton = createElement("button", "button button-primary", "Play");
    var warning = stationWarningText(station, source);

    playButton.type = "button";
    playButton.addEventListener("click", function () {
      playStation(station, { countPlay: false });
    });

    setupStationCardState(card, station);
    card.appendChild(logo);
    titleRow.appendChild(title);
    titleRow.appendChild(currentBadge);
    main.appendChild(titleRow);
    main.appendChild(meta);

    if (station.notes) {
      main.appendChild(createElement("p", "station-notes", station.notes));
    }

    if (warning) {
      main.appendChild(createElement("p", "station-warning", warning));
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
    var titleRow = createElement("div", "station-title-row saved-title-row");
    var title = createElement("h2", "station-title", station.name || "Radio senza nome");
    var currentBadge = createCurrentBadge();
    var actions = createElement("div", "station-actions");
    var playButton = createElement("button", "button saved-icon-button saved-play-button", "");
    var playIcon = createElement("span", "", "▶");
    var editButton = createElement("button", "button saved-icon-button saved-edit-button", "");
    var editIcon = createElement("span", "", "✎");

    playButton.type = "button";
    playButton.title = "Play";
    playButton.setAttribute("aria-label", "Play " + (station.name || "questa radio"));
    playButton.addEventListener("click", function () {
      playStation(station, { countPlay: true });
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
    setupStationCardState(card, station);
    titleRow.appendChild(title);
    titleRow.appendChild(currentBadge);
    card.appendChild(logo);
    card.appendChild(titleRow);
    card.appendChild(actions);
    return card;
  }

  function setupStationCardState(card, station) {
    card.dataset.stationKey = stationKey(station);
    updateStationCardState(card);
  }

  function createCurrentBadge() {
    var badge = createElement("span", "current-badge", "In play");
    badge.hidden = true;
    return badge;
  }

  function updateStationCardStates() {
    Array.prototype.forEach.call(document.querySelectorAll(".station-card[data-station-key]"), updateStationCardState);
  }

  function updateStationCardState(card) {
    var currentKey = state.currentStation ? stationKey(state.currentStation) : "";
    var isCurrent = Boolean(currentKey && card.dataset.stationKey === currentKey);
    var isPlaying = isCurrent && (state.playbackStatus === "playing" || state.playbackStatus === "loading");
    var badge = card.querySelector(".current-badge");

    card.classList.toggle("is-current", isCurrent);
    card.classList.toggle("is-playing", isPlaying);

    if (isPlaying) {
      card.setAttribute("aria-current", "true");
    } else {
      card.removeAttribute("aria-current");
    }

    if (badge) {
      badge.textContent = state.playbackStatus === "loading" ? "Carico" : "In play";
      badge.hidden = !isPlaying;
    }
  }

  function stationKey(station) {
    return normalizeUrl(station && station.streamUrl).toLowerCase();
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

  function stationWarningText(station, source) {
    var streamWarning = streamWarningText(station);
    if (streamWarning) {
      return streamWarning;
    }

    if (source === "search" && !station.codec && !station.bitrate) {
      return "Informazioni audio mancanti: prova Play prima di salvarla.";
    }

    return "";
  }

  function streamWarningText(station) {
    if (!station || !station.streamUrl) {
      return "";
    }

    if (isLikelyMixedContent(station.streamUrl)) {
      return "Stream HTTP: potrebbe essere bloccato quando l'app è in HTTPS.";
    }

    if (looksLikeHomepageUrl(station.streamUrl)) {
      return "Questo indirizzo sembra una homepage: potrebbe non essere lo stream diretto.";
    }

    return "";
  }

  function looksLikeHomepageUrl(value) {
    try {
      var parsed = new URL(normalizeUrl(value));
      var path = parsed.pathname.toLowerCase();

      if (/\.(html?|php|aspx?)$/i.test(path)) {
        return true;
      }

      return (!path || path === "/") && !parsed.port && !/(stream|listen|live|radio|audio)/i.test(parsed.hostname);
    } catch (error) {
      return false;
    }
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

    playStation(Object.assign({}, station, { id: "test-" + Date.now() }), { countPlay: false });
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
    performSearch(readSearchCriteria(), true);
  }

  function handleSearchInput() {
    var criteria = readSearchCriteria();
    state.searchRequestId += 1;

    if (!hasSearchCriteria(criteria)) {
      window.clearTimeout(state.searchTimer);
      clearElement(els.searchResults);
      clearSearchSummary();
      setSearchStatus("");
      return;
    }

    if (criteria.query && criteria.query.length < 2 && !criteria.country && !criteria.tag) {
      window.clearTimeout(state.searchTimer);
      clearElement(els.searchResults);
      clearSearchSummary();
      setSearchStatus("Continua a scrivere per cercare.");
      return;
    }

    window.clearTimeout(state.searchTimer);
    state.searchTimer = window.setTimeout(function () {
      performSearch(criteria, false);
    }, 450);
  }

  function handleFilterChange(changedFilter) {
    var before = JSON.stringify(readSearchCriteria());
    handleSearchInput();

    updateDependentFilters(changedFilter).then(function () {
      if (JSON.stringify(readSearchCriteria()) !== before) {
        handleSearchInput();
      }
    });
  }

  async function performSearch(criteria, focusIfEmpty) {
    var requestId = state.searchRequestId + 1;
    state.searchRequestId = requestId;

    if (!hasSearchCriteria(criteria)) {
      clearSearchSummary();
      setSearchStatus("Scrivi un nome oppure scegli paese o genere.");
      if (focusIfEmpty) {
        els.searchQuery.focus();
      }
      return;
    }

    if (criteria.query && criteria.query.length < 2 && !criteria.country && !criteria.tag) {
      clearSearchSummary();
      setSearchStatus("Scrivi almeno 2 caratteri per cercare.");
      return;
    }

    clearElement(els.searchResults);
    setSearchStatus("Cerco radio...");

    try {
      var results = await searchRadioBrowser(criteria);
      if (requestId !== state.searchRequestId) {
        return;
      }
      renderSearchResults(results, criteria);
    } catch (error) {
      if (requestId !== state.searchRequestId) {
        return;
      }
      clearElement(els.searchResults);
      clearSearchSummary();
      setSearchStatus("Non riesco a raggiungere Radio Browser. Puoi comunque aggiungere una radio manualmente.");
    }
  }

  function readSearchCriteria() {
    return {
      query: cleanText(els.searchQuery.value),
      country: els.searchCountry ? cleanText(els.searchCountry.value) : "",
      tag: els.searchTag ? cleanText(els.searchTag.value) : ""
    };
  }

  function hasSearchCriteria(criteria) {
    return Boolean(criteria && (criteria.query || criteria.country || criteria.tag));
  }

  async function searchRadioBrowser(criteria) {
    var searches = buildStationSearches(criteria);
    var collected = [];
    var hadSuccess = false;
    var lastError = null;

    for (var i = 0; i < searches.length; i += 1) {
      try {
        collected = collected.concat(await fetchRadioBrowserStations(searches[i]));
        hadSuccess = true;
      } catch (error) {
        lastError = error;
      }
    }

    if (!hadSuccess) {
      throw lastError || new Error("Radio Browser non raggiungibile");
    }

    return dedupeSearchResults(collected).slice(0, SEARCH_RESULT_LIMIT);
  }

  function buildStationSearches(criteria) {
    var searches = [buildStationSearchParams(criteria, criteria.query ? "name" : "")];

    if (criteria.query && !criteria.tag) {
      searches.push(buildStationSearchParams({
        query: "",
        country: criteria.country,
        tag: criteria.query
      }, "tag"));
    }

    return searches;
  }

  function buildStationSearchParams(criteria, searchMode) {
    var params = new URLSearchParams({
      limit: String(SEARCH_RESULT_LIMIT),
      hidebroken: "true",
      order: "clickcount",
      reverse: "true"
    });

    if (criteria.query && searchMode !== "tag") {
      params.set("name", criteria.query);
    }
    if (criteria.country) {
      params.set("countrycode", criteria.country);
    }
    if (criteria.tag) {
      params.set("tag", criteria.tag);
    }

    return params;
  }

  async function fetchRadioBrowserStations(params) {
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

        return data;
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError || new Error("Radio Browser non raggiungibile");
  }

  function dedupeSearchResults(items) {
    var seen = {};

    return items
      .map(mapRadioBrowserResult)
      .filter(Boolean)
      .filter(function (station) {
        var key = normalizeUrl(station.streamUrl).toLowerCase();
        if (!key || seen[key]) {
          return false;
        }

        seen[key] = true;
        return true;
      });
  }

  async function loadSearchFilters() {
    if (!els.searchCountry || !els.searchTag) {
      return;
    }

    populateFallbackFilters();

    try {
      var countries = await fetchRadioBrowserJson("/json/countrycodes", {
        order: "name",
        hidebroken: "true",
        limit: "300"
      });
      state.allCountries = normalizeCountries(countries);
      populateCountryFilter(state.allCountries);
    } catch (error) {
      // I filtri base restano disponibili.
    }

    try {
      var tags = await fetchRadioBrowserJson("/json/tags", {
        order: "stationcount",
        reverse: "true",
        hidebroken: "true",
        limit: "1200"
      });
      state.allTags = normalizeTags(tags).filter(isGenreTag);
      populateTagFilter(state.allTags);
    } catch (error) {
      // I filtri base restano disponibili.
    }

    state.filtersLoaded = true;
  }

  async function fetchRadioBrowserJson(path, params) {
    var query = new URLSearchParams(params || {});
    var lastError = null;

    for (var i = 0; i < RADIO_BROWSER_BASE_URLS.length; i += 1) {
      try {
        var response = await fetchWithTimeout(RADIO_BROWSER_BASE_URLS[i] + path + "?" + query.toString(), 12000);
        if (!response.ok) {
          throw new Error("HTTP " + response.status);
        }

        var data = await response.json();
        if (!Array.isArray(data)) {
          throw new Error("Formato risposta non valido");
        }

        return data;
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError || new Error("Radio Browser non raggiungibile");
  }

  function populateFallbackFilters() {
    state.allCountries = normalizeCountries([
      { name: "Argentina", iso_3166_1: "AR" },
      { name: "Brazil", iso_3166_1: "BR" },
      { name: "France", iso_3166_1: "FR" },
      { name: "Germany", iso_3166_1: "DE" },
      { name: "Italy", iso_3166_1: "IT" },
      { name: "Mexico", iso_3166_1: "MX" },
      { name: "Spain", iso_3166_1: "ES" },
      { name: "United Kingdom", iso_3166_1: "GB" },
      { name: "United States", iso_3166_1: "US" }
    ]);
    state.allTags = normalizeTags(GENRE_TAGS);
    populateCountryFilter(state.allCountries);
    populateTagFilter(state.allTags);
  }

  function populateCountryFilter(countries) {
    var currentValue = els.searchCountry.value;
    resetSelect(els.searchCountry, "Tutti i paesi");

    normalizeCountries(countries).forEach(function (country) {
      var option = document.createElement("option");
      option.value = country.value;
      option.textContent = country.label;
      els.searchCountry.appendChild(option);
    });

    if (currentValue) {
      els.searchCountry.value = currentValue;
      if (els.searchCountry.value !== currentValue) {
        els.searchCountry.value = "";
      }
    }
  }

  function populateTagFilter(tags) {
    var currentValue = els.searchTag.value;
    resetSelect(els.searchTag, "Tutti i generi");

    normalizeTags(tags).forEach(function (tag) {
      var option = document.createElement("option");
      option.value = tag.value;
      option.textContent = tag.label;
      els.searchTag.appendChild(option);
    });

    if (currentValue) {
      els.searchTag.value = currentValue;
      if (els.searchTag.value !== currentValue) {
        els.searchTag.value = "";
      }
    }
  }

  async function updateDependentFilters(changedFilter) {
    var criteria = readSearchCriteria();
    var requestId = state.filterRequestId + 1;
    state.filterRequestId = requestId;

    try {
      if (changedFilter === "country") {
        if (!criteria.country) {
          populateTagFilter(state.allTags);
          return;
        }

        var countryStations = await fetchFilterStations({ country: criteria.country });
        if (requestId !== state.filterRequestId) {
          return;
        }
        populateTagFilter(extractTagsFromStations(countryStations).filter(isGenreTag));
        return;
      }

      if (changedFilter === "tag") {
        if (!criteria.tag) {
          populateCountryFilter(state.allCountries);
          return;
        }

        var tagStations = await fetchFilterStations({ tag: criteria.tag });
        if (requestId !== state.filterRequestId) {
          return;
        }
        populateCountryFilter(extractCountriesFromStations(tagStations));
      }
    } catch (error) {
      if (changedFilter === "country") {
        populateTagFilter(state.allTags);
      } else {
        populateCountryFilter(state.allCountries);
      }
    }
  }

  async function fetchFilterStations(criteria) {
    var params = buildStationSearchParams({
      query: "",
      country: criteria.country || "",
      tag: criteria.tag || ""
    }, "");
    params.set("limit", String(FILTER_SAMPLE_LIMIT));
    return fetchRadioBrowserStations(params);
  }

  function extractTagsFromStations(stations) {
    var tags = [];
    stations.forEach(function (station) {
      cleanText(station.tags).split(",").forEach(function (tag) {
        var cleaned = cleanText(tag);
        if (cleaned) {
          tags.push({ name: cleaned });
        }
      });
    });
    return normalizeTags(tags);
  }

  function extractCountriesFromStations(stations) {
    return normalizeCountries(stations.map(function (station) {
      return {
        name: station.country,
        iso_3166_1: station.countrycode
      };
    }));
  }

  function normalizeCountries(countries) {
    var seen = {};
    var displayNames = getCountryDisplayNames();

    return (countries || [])
      .map(function (country) {
        var code = cleanText(country.value || country.iso_3166_1 || country.countrycode || country.code || country.name).toUpperCase();
        var label = cleanText(country.country || country.label || (code.length === 2 && displayNames ? displayNames.of(code) : "") || country.name);

        return {
          label: label,
          value: code
        };
      })
      .filter(function (country) {
        if (!country.label || country.value.length !== 2 || seen[country.value]) {
          return false;
        }

        seen[country.value] = true;
        return true;
      })
      .sort(compareByLabel);
  }

  function normalizeTags(tags) {
    var seen = {};

    return (tags || [])
      .map(function (tag) {
        var name = cleanTagName(typeof tag === "string" ? tag : tag.value || tag.name);
        return {
          label: titleCase(cleanTagName(tag.label) || name),
          value: name
        };
      })
      .filter(function (tag) {
        var key = tag.value.toLowerCase();
        if (!tag.value || seen[key]) {
          return false;
        }

        seen[key] = true;
        return true;
      })
      .sort(compareByLabel);
  }

  function isGenreTag(tag) {
    var value = cleanText(tag.value).toLowerCase();
    if (!value) {
      return false;
    }

    return GENRE_TAGS.some(function (genre) {
      return value === genre || value.indexOf(genre + " ") !== -1 || value.indexOf(" " + genre) !== -1;
    });
  }

  function cleanTagName(value) {
    return cleanText(value)
      .replace(/^[^0-9A-Za-zÀ-ÖØ-öø-ÿ]+/, "")
      .replace(/[^0-9A-Za-zÀ-ÖØ-öø-ÿ]+$/, "")
      .replace(/\s+/g, " ");
  }

  function compareByLabel(a, b) {
    return a.label.localeCompare(b.label, "it", { sensitivity: "base" });
  }

  function getCountryDisplayNames() {
    if (!("Intl" in window) || !("DisplayNames" in Intl)) {
      return null;
    }

    try {
      return new Intl.DisplayNames(["it"], { type: "region" });
    } catch (error) {
      return null;
    }
  }

  function resetSelect(select, label) {
    clearElement(select);
    var option = document.createElement("option");
    option.value = "";
    option.textContent = label;
    select.appendChild(option);
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
    var logoUrl = chooseLogoUrl(item.favicon, item.homepage);

    return {
      id: item.stationuuid ? "radio-browser-" + item.stationuuid : createStationId(),
      name: cleanText(item.name) || generateNameFromUrl(streamUrl),
      streamUrl: streamUrl,
      logoUrl: logoUrl,
      notes: "",
      createdAt: new Date().toISOString(),
      country: cleanText(item.country),
      codec: cleanText(item.codec),
      bitrate: Number(item.bitrate) > 0 ? Number(item.bitrate) : ""
    };
  }

  function chooseLogoUrl(favicon, homepage) {
    var directIcon = normalizeUrl(favicon);
    if (isValidHttpUrl(directIcon)) {
      return directIcon;
    }

    var home = normalizeUrl(homepage);
    if (!isValidHttpUrl(home)) {
      return "";
    }

    try {
      return new URL("/favicon.ico", home).href;
    } catch (error) {
      return "";
    }
  }

  function renderSearchResults(results, criteria) {
    clearElement(els.searchResults);
    setSearchSummary(criteria, results.length);

    if (!results.length) {
      setSearchStatus("Nessun risultato valido. Prova con un nome più generico.");
      return;
    }

    setSearchStatus("");
    results.forEach(function (station) {
      els.searchResults.appendChild(createStationCard(station, "search"));
    });
    updateStationCardStates();
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

  function setSearchSummary(criteria, count) {
    if (!els.searchSummary || !criteria) {
      clearSearchSummary();
      return;
    }

    var parts = [];
    if (criteria.query) {
      parts.push(criteria.query);
    }
    if (criteria.country) {
      parts.push(selectedOptionLabel(els.searchCountry));
    }
    if (criteria.tag) {
      parts.push(selectedOptionLabel(els.searchTag));
    }

    if (typeof count === "number") {
      parts.push(count === 1 ? "1 risultato" : count + " risultati");
    }

    if (!parts.length) {
      clearSearchSummary();
      return;
    }

    els.searchSummary.textContent = parts.join(" · ");
    els.searchSummary.hidden = false;
  }

  function clearSearchSummary() {
    if (!els.searchSummary) {
      return;
    }

    els.searchSummary.textContent = "";
    els.searchSummary.hidden = true;
  }

  function selectedOptionLabel(select) {
    if (!select || !select.selectedOptions || !select.selectedOptions.length) {
      return "";
    }

    return cleanText(select.selectedOptions[0].textContent);
  }

  function playStation(station, options) {
    var opts = options || {};
    var sanitized = sanitizeStation(station);
    if (!sanitized) {
      showMessage("Questa radio non ha un URL stream valido.", "error");
      return;
    }

    var warning = streamWarningText(sanitized);
    if (warning) {
      showMessage(warning, "warning", true);
    }

    var same = state.currentStation && sameStationOrUrl(state.currentStation, sanitized);
    if (same && !els.audio.paused) {
      highlightPlayer();
      return;
    }

    if (opts.countPlay) {
      sanitized = recordStationPlay(sanitized);
    }

    selectStation(sanitized, true);
  }

  function recordStationPlay(station) {
    var index = state.stations.findIndex(function (item) {
      return sameStationOrUrl(item, station);
    });

    if (index === -1) {
      return station;
    }

    var updated = Object.assign({}, state.stations[index], {
      playCount: safeNumber(state.stations[index].playCount) + 1,
      lastPlayedAt: new Date().toISOString()
    });

    state.stations[index] = updated;
    saveStations(state.stations);

    if (state.currentStation && sameStationOrUrl(state.currentStation, updated)) {
      state.currentStation = updated;
      saveCurrentStation(updated);
    }

    renderStations();
    return updated;
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

  function playCurrentStation(options) {
    var opts = options || {};
    if (!state.currentStation) {
      showMessage("Scegli prima una radio.", "warning");
      return;
    }

    if (opts.countPlay) {
      state.currentStation = recordStationPlay(state.currentStation);
      saveCurrentStation(state.currentStation);
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
    var requestId = state.playRequestId + 1;
    state.playRequestId = requestId;
    var playPromise = els.audio.play();
    if (playPromise && typeof playPromise.catch === "function") {
      playPromise.catch(function () {
        if (requestId !== state.playRequestId) {
          return;
        }

        setMediaVolume(AUDIO_TARGET_VOLUME);
        setPlaybackStatus("paused");
        showPlayerError("L'audio non è partito. Tocca Play nel player o verifica che lo stream sia compatibile.");
      });
    }
  }

  function handlePlayerToggle() {
    if (!state.currentStation) {
      return;
    }

    if (state.playbackStatus === "loading" || !els.audio.paused) {
      stopPlayer(false, { fade: true, intent: "stop" });
      return;
    }

    playCurrentStation({ countPlay: true });
  }

  function renderPlayer() {
    clearElement(els.playerLogo);
    hidePlayerError();

    if (!state.currentStation) {
      document.body.classList.remove("has-player");
      els.playerLogo.appendChild(createElement("span", "", "-"));
      els.playerTitle.textContent = "Nessuna radio selezionata";
      els.playerStatus.textContent = "Scegli una radio";
      els.audio.hidden = true;
      els.playerToggleButton.disabled = true;
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
    state.playRequestId += 1;

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

      if (clearCurrent) {
        state.currentStation = null;
        saveCurrentStation(null);
        setPlaybackStatus("idle");
        updateMediaSessionPlaybackState("none");
        renderPlayer();
      } else {
        setPlaybackStatus("ready");
        updateMediaSessionPlaybackState("paused");
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
    updatePlayerStatusText();
    updateStationCardStates();
  }

  function updatePlayerStatusText() {
    if (!els.playerStatus) {
      return;
    }

    var statusText = "Fermata";
    if (!state.currentStation || state.playbackStatus === "idle") {
      statusText = "Scegli una radio";
    } else if (state.playbackStatus === "loading") {
      statusText = "Carico...";
    } else if (state.playbackStatus === "playing") {
      statusText = "In riproduzione";
    } else if (state.playbackStatus === "error") {
      statusText = "Errore stream";
    }

    els.playerStatus.textContent = statusText;
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
        playCurrentStation({ countPlay: true });
      });
      navigator.mediaSession.setActionHandler("pause", function () {
        stopPlayer(false, { fade: true, intent: "stop" });
      });
      navigator.mediaSession.setActionHandler("stop", function () {
        stopPlayer(false, { fade: true, intent: "stop" });
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
      els.playerToggleButton.setAttribute("aria-label", "Stop caricamento " + state.currentStation.name);
      return;
    }

    if (!els.audio.paused && state.playbackStatus === "playing") {
      els.playerToggleIcon.textContent = "■";
      els.playerToggleButton.setAttribute("aria-label", "Stop " + state.currentStation.name);
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

    var mode = askImportMode();
    if (!mode) {
      return;
    }

    var summary = mergeImportedStations(incoming, mode);
    renderStations();
    setActiveTab("radio");
    showMessage(importSummaryMessage(summary), summary.imported ? "success" : "warning", true);
  }

  function askImportMode() {
    var answer = window.prompt("Come vuoi importare la lista?\n\nScrivi:\n- aggiungi: mantiene le radio esistenti e aggiunge le nuove\n- sostituisci: cancella la lista attuale e usa il file importato", "aggiungi");
    var normalized = cleanText(answer).toLowerCase();

    if (!normalized) {
      showMessage("Import annullato.", "warning");
      return "";
    }
    if (normalized === "aggiungi" || normalized === "a") {
      return "append";
    }
    if (normalized === "sostituisci" || normalized === "s") {
      return "replace";
    }

    showMessage("Scelta non riconosciuta. Scrivi aggiungi oppure sostituisci.", "error", true);
    return "";
  }

  function mergeImportedStations(incoming, mode) {
    var summary = { imported: 0, duplicates: 0, invalid: 0, mode: mode };
    var initialStations = mode === "replace" ? [] : state.stations;
    var knownUrls = new Set(initialStations.map(function (station) {
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

    if (mode === "replace") {
      if (!validStations.length) {
        return summary;
      }

      state.stations = validStations;
      saveStations(state.stations);
      reconcileCurrentStationAfterReplace();
      return summary;
    }

    if (validStations.length) {
      state.stations = validStations.concat(state.stations);
      saveStations(state.stations);
    }

    return summary;
  }

  function reconcileCurrentStationAfterReplace() {
    if (!state.currentStation) {
      return;
    }

    var matchingStation = state.stations.find(function (station) {
      return sameStationOrUrl(station, state.currentStation);
    });

    if (matchingStation) {
      state.currentStation = matchingStation;
      saveCurrentStation(matchingStation);
      selectStation(matchingStation, false);
      return;
    }

    stopPlayer(true);
  }

  function importSummaryMessage(summary) {
    var action = summary.mode === "replace" ? "sostituita" : "aggiornata";

    if (summary.mode === "replace" && !summary.imported) {
      return "Import annullato: nessuna radio valida nel file. " + summary.invalid + " non valide ignorate.";
    }

    return "Lista " + action + ": " + summary.imported + " importate, " + summary.duplicates + " duplicate saltate, " + summary.invalid + " non valide ignorate.";
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
    clearSearchSummary();
    setSearchStatus("");
    renderStations();
    showMessage("Dati locali cancellati.", "success");
  }

  async function refreshApp() {
    closeSettings();
    showMessage("Aggiorno l'app...", "info", true);

    try {
      if ("caches" in window) {
        var cacheNames = await caches.keys();
        await Promise.all(cacheNames
          .filter(function (cacheName) {
            return cacheName.indexOf("le-mie-radio-") === 0;
          })
          .map(function (cacheName) {
            return caches.delete(cacheName);
          }));
      }

      if ("serviceWorker" in navigator) {
        var registrations = await navigator.serviceWorker.getRegistrations();
        await Promise.all(registrations.map(function (registration) {
          if (registration.waiting) {
            registration.waiting.postMessage({ type: "SKIP_WAITING" });
          }
          return registration.update();
        }));
      }
    } catch (error) {
      // Anche se la cache non si svuota, proviamo comunque a ricaricare.
    }

    var url = new URL(window.location.href);
    url.searchParams.set("v", APP_VERSION);
    window.location.replace(url.toString());
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
