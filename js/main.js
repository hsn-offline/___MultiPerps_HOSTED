
// CONFIGURATION

    const CONFIG = {
          DEFAULT_SYMBOL: 'BTCUSDT',
          INTERVALS: ['1m', '5m', '15m', '30m', '1h', '4h', '1d', '1w', '1M'],
          KLINE_LIMIT: 80,
          WS_RECONNECT_DELAY_MS: 2000,
          CHART_UPDATE_INTERVAL_MS: 1000,
          HEALTH_UPDATE_INTERVAL_MS: 1000,
          FETCH_TIMEOUT_MS: 8000,
          STALE_RECONNECT_MS: 30000,
          FUTURES_EXCHANGE_INFO_URL: 'https://fapi.binance.com/fapi/v1/exchangeInfo',
          FUTURES_SYMBOLS_CACHE_TTL_MS: 24 * 60 * 60 * 1000,
          RANKINGS_REFRESH_MS: 1000,
          RANKINGS_RENDER_MS: 1000,
          RANKINGS_TOP_N: 10,
          OI_FETCH_BATCH_SIZE: 10,
          OI_FETCH_DELAY_MS: 50,
        };
        const STORAGE = {
          symbol: 'alert_symbol',
          tickerInput: 'alert_ticker_input',
          futuresSymbolsCache: 'alert_futures_symbols_cache',
          futuresFavorites: 'alert_futures_favorites',
          recentTickers: 'pv_recent_tickers_v1',
          multiAlerts: 'pv_multi_alerts_v3',
          alertPermission: 'pv_alert_permission_v1',
          alertLogHistory: 'pv_alert_log_history_v2',
        };

    // ── Multi-tab connection limit tracking ──
        const _tabId = Date.now().toString(36) + Math.random().toString(36).slice(2);
        const _tabChannel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('multiperps_tabs') : null;
        const _getTabCount = () => {
          try {
            const tabs = JSON.parse(localStorage.getItem('pv_active_tabs') || '{}');
            const now = Date.now();
            for (const id in tabs) {
              if (now - tabs[id] > 30000) delete tabs[id];
            }
            return Object.keys(tabs).length;
          } catch {
            return 1;
          }
        };
        const _registerTab = () => {
          try {
            const tabs = JSON.parse(localStorage.getItem('pv_active_tabs') || '{}');
            tabs[_tabId] = Date.now();
            safeLocalStorageSet('pv_active_tabs', JSON.stringify(tabs));
          } catch {}
        };
        const _unregisterTab = () => {
          try {
            const tabs = JSON.parse(localStorage.getItem('pv_active_tabs') || '{}');
            delete tabs[_tabId];
            safeLocalStorageSet('pv_active_tabs', JSON.stringify(tabs));
          } catch {}
        };
        setInterval(_registerTab, 10000);
        setTimeout(_registerTab, 0);
        window.addEventListener('beforeunload', _unregisterTab);
        if (_tabChannel) {
          _tabChannel.onmessage = (e) => {
            if (e.data === 'tab_update') {
              const count = _getTabCount();
              if (count > 8) {
                showBinanceWarning('Multiple Tabs',
                  `You have ${count} MultiPerps tabs open. This may exceed Binance's 300-connection/5min limit. Consider closing some tabs.`,
                  'down');
              }
            }
          };
        }
        setTimeout(() => {
          const count = _getTabCount();
          if (count > 8) {
            showBinanceWarning('Multiple Tabs',
              `You have ${count} MultiPerps tabs open. This may exceed Binance's 300-connection/5min limit. Consider closing some tabs.`,
              'down');
          }
          if (_tabChannel) _tabChannel.postMessage('tab_update');
        }, 3000);

//ALERT

        const ALERT_TYPE_CONFIG = {
          price: {
            label: 'Price',
            unit: 'USDT',
            placeholder: 'Price',
            restUrl: (sym) => `https://fapi.binance.com/fapi/v1/ticker/price?symbol=${encodeURIComponent(sym)}`,
            parseValue: (data) => parseFloat(data?.price || data?.c),
            formatValue: (v) => '$' + formatPlainNumber(v),
            formatThreshold: (v) => formatPrice(v),
          },
          funding: {
            label: 'Funding',
            unit: '%',
            placeholder: 'Funding %',
            restUrl: (sym) => `https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${encodeURIComponent(sym)}`,
            parseValue: (data) => {
              const r = parseFloat(data?.lastFundingRate ?? data?.r);
              return Number.isFinite(r) ? r * 100 : null;
            },
            formatValue: (v) => (v >= 0 ? '+' : '') + v.toFixed(4) + '%',
            formatThreshold: (v) => v.toFixed(4) + '%',
          }
        };

//STATE MANAGEMENT

        const loadMultiAlerts = () => {
          try {
            let raw = localStorage.getItem(STORAGE.multiAlerts);
            if (!raw) raw = localStorage.getItem('pv_multi_alerts_v2');
            if (!raw) return [];
            const parsed = JSON.parse(raw);
            if (!Array.isArray(parsed)) return [];
            const result = parsed.map(a => {
              if (!a || a._pendingRemoval || !a.ticker) return null;
              if (a.price !== undefined && !a.alertType) {
                a.alertType = 'price';
                a.threshold = a.price;
                delete a.price;
              }
              if (a._savedLastValue !== undefined && Number.isFinite(a._savedLastValue)) {
                const age = a._savedLastValueTime ? (Date.now() - a._savedLastValueTime) : Infinity;
                if (age < 300000) {
                  a.lastValue = a._savedLastValue;
                  a._lastValueTime = a._savedLastValueTime;
                }
                delete a._savedLastValue;
                delete a._savedLastValueTime;
              }
              return a;
            }).slice(0, 4);
            while (result.length > 0 && result[result.length - 1] === null) {
              result.pop();
            }
            return result;
          } catch {
            return [];
          }
        };
        const saveMultiAlerts = (alerts) => {
          try {
            const serializable = alerts.slice(0, 4).map(a => {
              if (!a) return null;
              const obj = {
                ...a
              };
              if (Number.isFinite(a.lastValue) && a._lastValueTime && (Date.now() - a._lastValueTime < 300000)) {
                obj._savedLastValue = a.lastValue;
                obj._savedLastValueTime = a._lastValueTime;
              }
              delete obj.lastValue;
              delete obj._lastValueTime;
              return obj;
            });
            safeLocalStorageSet(STORAGE.multiAlerts, JSON.stringify(serializable));
          } catch {}
        };
        const hasAlertPermission = () => {
          try {
            return localStorage.getItem(STORAGE.alertPermission) === 'granted';
          } catch {
            return false;
          }
        };
        const loadAlertLogHistory = () => {
          try {
            const raw = localStorage.getItem(STORAGE.alertLogHistory);
            if (!raw) return {};
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) {
              const obj = {};
              parsed.forEach((entry, idx) => {
                obj[idx + 1] = entry;
              });
              return obj;
            }
            return (parsed && typeof parsed === 'object') ? parsed : {};
          } catch {
            return {};
          }
        };
        const saveAlertLogHistory = (logs) => {
          try {
            safeLocalStorageSet(STORAGE.alertLogHistory, JSON.stringify(logs));
          } catch {}
        };
        const setAlertPermission = () => {
          try {
            safeLocalStorageSet(STORAGE.alertPermission, 'granted');
          } catch {}
        };
        const loadStored = (key, fallback) => {
          try {
            const v = localStorage.getItem(key);
            return v === null ? fallback : v;
          } catch {
            return fallback;
          }
        };
        const saveStored = (key, value) => {
          try {
            safeLocalStorageSet(key, String(value));
          } catch {}
        };
        const safeLocalStorageSet = (key, value) => {
          try {
            localStorage.setItem(key, value);
            return true;
          } catch (e) {
            if (e.name === 'QuotaExceededError' || (e.code && e.code === 22) || e.message?.includes('quota')) {
              try {
                localStorage.removeItem(STORAGE.alertLogHistory);
              } catch {}
              try {
                localStorage.removeItem(STORAGE.futuresSymbolsCache);
              } catch {}
              try {
                localStorage.setItem(key, value);
                showToast('Storage', 'Storage full — cleared old cache data', 'down');
                return true;
              } catch {}
            }
            console.warn('localStorage.setItem failed:', key, e.message);
            return false;
          }
        };
        const normalizeSymbolValue = (value) => {
          const clean = String(value || '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
          if (!clean) return '';
          return clean.endsWith('USDT') ? clean : (clean + 'USDT');
        };
        const getSymbolFromUrl = () => {
          try {
            const raw = new URLSearchParams(window.location.search).get('symbol');
            if (raw) return normalizeSymbolValue(raw);
            const path = window.location.pathname.replace(/^\/+/, '').replace(/\/+$/, '');
            if (path && /^[A-Z0-9]{2,20}USDT$/i.test(path)) return normalizeSymbolValue(path);
            return '';
          } catch {
            return '';
          }
        };
        const setUrlSymbol = (symbol) => {
          try {
            const url = new URL(window.location.href);
            const sym = normalizeSymbolValue(symbol);
            if (sym) url.searchParams.set('symbol', sym);
            else url.searchParams.delete('symbol');
            window.history.replaceState(null, '', url.toString());
          } catch {}
        };
        const urlSymbolInitial = getSymbolFromUrl();

//FAVORITES

        const loadFuturesFavorites = () => {
          try {
            const raw = localStorage.getItem(STORAGE.futuresFavorites);
            if (!raw) return new Set();
            const parsed = JSON.parse(raw);
            if (!Array.isArray(parsed)) return new Set();
            return new Set(parsed.map((t) => String(t || '').toUpperCase()).filter(Boolean));
          } catch {
            return new Set();
          }
        };
        const saveFuturesFavorites = () => {
          try {
            safeLocalStorageSet(STORAGE.futuresFavorites, JSON.stringify(Array.from(state.futuresFavorites)));
          } catch {}
        };
        const loadRecentTickers = () => {
          try {
            const raw = localStorage.getItem(STORAGE.recentTickers);
            if (!raw) return [];
            const parsed = JSON.parse(raw);
            if (!Array.isArray(parsed)) return [];
            return parsed.map(t => String(t || '').toUpperCase()).filter(Boolean).slice(0, 10);
          } catch {
            return [];
          }
        };
        const saveRecentTickers = (tickers) => {
          try {
            safeLocalStorageSet(STORAGE.recentTickers, JSON.stringify(tickers.slice(0, 10)));
          } catch {}
        };
        const addRecentTicker = (ticker) => {
          const t = String(ticker || '').toUpperCase();
          if (!t) return;
          const recent = loadRecentTickers();
          const idx = recent.indexOf(t);
          if (idx >= 0) recent.splice(idx, 1);
          recent.unshift(t);
          saveRecentTickers(recent);
        };
        const isFavoriteTicker = (ticker) => {
          return state.futuresFavorites.has(String(ticker || '').toUpperCase());
        };
        const toggleFavoriteTicker = (ticker) => {
          const t = String(ticker || '').toUpperCase();
          if (!t) return;
          if (state.futuresFavorites.has(t)) state.futuresFavorites.delete(t);
          else state.futuresFavorites.add(t);
          saveFuturesFavorites();
          renderFavTickers();
        };
        const renderFavTickers = () => {
          const listEl = document.getElementById('favTickersList');
          const favs = Array.from(state.futuresFavorites);
          if (!listEl) return;
          if (favs.length === 0) {
            listEl.innerHTML =
              '<span class="fav-tickers-empty">No favourites yet. Use ★ in the search dropdown to add.<\/span>';
            return;
          }
          listEl.innerHTML = '';
          for (const ticker of favs) {
            const chip = document.createElement('span');
            chip.className = 'fav-ticker-chip';
            chip.title = `Load ${ticker}`;
            const name = document.createElement('span');
            name.textContent = ticker.replace('USDT', '');
            chip.appendChild(name);
            const remove = document.createElement('span');
            remove.className = 'fav-remove';
            remove.textContent = '✕';
            remove.title = `Remove ${ticker} from favourites`;
            remove.addEventListener('click', (e) => {
              e.stopPropagation();
              toggleFavoriteTicker(ticker);
            });
            chip.appendChild(remove);
            chip.addEventListener('click', () => {
              loadSymbol(ticker);
            });
            listEl.appendChild(chip);
          }
        };
        const state = {
          symbol: urlSymbolInitial || loadStored(STORAGE.symbol, CONFIG.DEFAULT_SYMBOL),
          urlSymbolMode: Boolean(urlSymbolInitial),
          isRunning: true,
          ws: null,
          wsStatus: {
            text: 'Initializing...',
            level: 'connecting'
          },
          reconnectAttempts: 0,
          wsGeneration: 0,
          secondaryWs: null,
          secondaryWsGeneration: 0,
          secondaryReconnectAttempts: 0,
          secondaryReconnectTimer: null,
          reconnectTimer: null,
          lastMessageTime: null,
          lastTradeTime: null,
          currentPrice: null,
          msgsInWindow: 0,
          chartTimer: null,
          healthTimer: null,
          audioContext: null,
          alertLog: loadAlertLogHistory(),
          multiAlerts: loadMultiAlerts(),
          alertPrices: {},
          alertTimer: null,
          _alertMonitorRunning: false,
          alertWsData: {},
          alertFundingData: {},
          charts: {},
          elements: {},
          futuresTickerItems: [],
          futuresFavorites: loadFuturesFavorites(),
          tickerSuggest: {
            visible: false,
            activeIndex: -1,
            items: [],
            filter: 'all',
            ignoreBlurUntil: 0,
            activeInput: null,
            onSelectCallback: null
          },
          tickerInputDebounce: null,
          rankings: {
            data: [],
            fundingData: [],
            renderTimer: null,
            oiTimer: null,
            ws: null,
            wsGeneration: 0,
            reconnectTimer: null,
            tickerMap: new Map(),
            fundingMap: new Map(),
            lastPrices: new Map(),
            lastVolumes: new Map(),
            lastPcts: new Map(),
            _wasConnected: false,
          },
        };
        const normalizeSymbol = normalizeSymbolValue;
        const toDisplayTicker = (symbol) => {
          const s = String(symbol || '').toUpperCase();
          return s.endsWith('USDT') ? s.slice(0, -4) : s;
        };
        const getBinanceFuturesUrl = (symbol) => {
          const sym = normalizeSymbol(symbol);
          return sym ? `https://www.binance.com/en/futures/${encodeURIComponent(sym)}` :
            'https://www.binance.com/en/futures';
        };
        const formatPrice = (value) => {
          if (!Number.isFinite(value)) return '-----';
          return `${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 8 })}`;
        };
        const formatPlainNumber = (value) => {
          if (!Number.isFinite(value)) return '';
          return value.toLocaleString('en-US', {
            useGrouping: false,
            minimumFractionDigits: 0,
            maximumFractionDigits: 8
          });
        };
        const formatUsdtVolume = (value) => {
          if (!Number.isFinite(value)) return '';
          try {
            const n = new Intl.NumberFormat('en-US', {
              notation: 'compact',
              maximumFractionDigits: 1
            }).format(value);
            return `${n}`;
          } catch {
            return `${Math.round(value).toLocaleString('en-US')} USDT`;
          }
        };
        const formatOiValue = (oi) => {
          if (!Number.isFinite(oi)) return '—';
          if (oi >= 1e9) return (oi / 1e9).toFixed(2) + 'B';
          if (oi >= 1e6) return (oi / 1e6).toFixed(2) + 'M';
          if (oi >= 1e3) return (oi / 1e3).toFixed(1) + 'K';
          return oi.toFixed(2);
        };
        const formatCompact = (value) => {
          if (!Number.isFinite(value)) return '—';
          try {
            return new Intl.NumberFormat('en-US', {
              notation: 'compact',
              maximumFractionDigits: 2
            }).format(value);
          } catch {
            return value.toLocaleString('en-US');
          }
        };
        const formatCompactNotional = (value) => {
          if (!Number.isFinite(value)) return '—';
          try {
            return '$' + new Intl.NumberFormat('en-US', {
              notation: 'compact',
              maximumFractionDigits: 2
            }).format(value);
          } catch {
            return '$' + value.toLocaleString('en-US');
          }
        };
        const copyText = async (text) => {
          if (!text) return false;
          try {
            if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
              await navigator.clipboard.writeText(text);
              return true;
            }
          } catch {}
          try {
            const ta = document.createElement('textarea');
            ta.value = text;
            ta.style.position = 'fixed';
            ta.style.left = '-9999px';
            ta.style.top = '0';
            document.body.appendChild(ta);
            ta.focus();
            ta.select();
            const ok = document.execCommand('copy');
            ta.remove();
            return ok;
          } catch {
            return false;
          }
        };
        const WS_MAX_RECONNECT_ATTEMPTS = 10;
        const calcReconnectDelayMs = (attempt) => {
          const base = CONFIG.WS_RECONNECT_DELAY_MS;
          const max = 30000;
          const step = Math.min(6, Math.max(0, attempt));
          const delay = Math.min(max, base * Math.pow(2, step));
          const jitter = Math.floor(Math.random() * 250);
          return delay + jitter;
        };
        const clearReconnectTimer = () => {
          if (state.reconnectTimer) {
            clearTimeout(state.reconnectTimer);
            state.reconnectTimer = null;
          }
        };
        const getPriceAtCanvasY = (canvas, candles, clientY) => {
          if (!canvas || !candles || candles.length === 0) return null;
          const rect = canvas.getBoundingClientRect();
          const dpr = rect.width ? (canvas.width / rect.width) : (window.devicePixelRatio || 1);
          const y = (clientY - rect.top) * dpr;
          const width = canvas.width;
          const height = canvas.height;
          const padding = Math.max(8, Math.floor(width * 0.02));
          const chartH = height - padding * 2;
          if (chartH <= 1) return null;
          const prices = [];
          for (const c of candles) {
            prices.push(c.high, c.low);
          }
          const minP = Math.min(...prices);
          const maxP = Math.max(...prices);
          const range = (maxP - minP) || 1;
          const clampedY = Math.max(padding, Math.min(height - padding, y));
          const t = 1 - ((clampedY - padding) / chartH);
          const p = minP + t * range;
          return Number.isFinite(p) ? p : null;
        };
        const getCandleIndexAtCanvasX = (canvas, candles, clientX) => {
          if (!canvas || !candles || candles.length === 0) return null;
          const rect = canvas.getBoundingClientRect();
          const dpr = rect.width ? (canvas.width / rect.width) : (window.devicePixelRatio || 1);
          const x = (clientX - rect.left) * dpr;
          const width = canvas.width;
          const padding = Math.max(8, Math.floor(width * 0.02));
          const chartW = width - padding * 2;
          if (chartW <= 1) return null;
          const count = candles.length;
          const slot = chartW / count;
          const rel = x - padding;
          const idx = Math.floor(rel / slot);
          if (!Number.isFinite(idx)) return null;
          if (idx < 0 || idx >= count) return null;
          return idx;
        };
        const hideChartContextMenu = () => {
          const menu = document.getElementById('chartContextMenu');
          if (menu) {
            menu.style.display = 'none';
          }
        };
        const showChartContextMenu = (x, y, title, price) => {
          let menu = document.getElementById('chartContextMenu');
          if (!menu) {
            menu = document.createElement('div');
            menu.id = 'chartContextMenu';
            menu.className = 'chart-context-menu';
            document.body.appendChild(menu);
            document.addEventListener('click', () => hideChartContextMenu());
            document.addEventListener('keydown', (e) => {
              if (e.key === 'Escape') hideChartContextMenu();
            });
            window.addEventListener('blur', () => hideChartContextMenu());
            window.addEventListener('scroll', () => hideChartContextMenu(), true);
            window.addEventListener('resize', () => hideChartContextMenu());
          }
          const plain = formatPlainNumber(price);
          menu.innerHTML = `
<button class="menu-btn" type="button" id="copyLevelBtn">Copy ${plain}<\/button>
`;
          const pad = 8;
          menu.style.display = 'block';
          const rect = menu.getBoundingClientRect();
          const maxLeft = window.innerWidth - rect.width - pad;
          const maxTop = window.innerHeight - rect.height - pad;
          let left = x - rect.width / 2;
          left = Math.max(pad, Math.min(left, maxLeft));
          const gap = 10;
          let top = y - rect.height - gap;
          if (top < pad) {
            top = y + gap;
          }
          top = Math.max(pad, Math.min(top, maxTop));
          menu.style.left = `${left}px`;
          menu.style.top = `${top}px`;
          const btn = menu.querySelector('#copyLevelBtn');
          if (btn) {
            btn.addEventListener('click', async (e) => {
              e.stopPropagation();
              const ok = await copyText(plain);
              btn.textContent = ok ? `Copied: ${plain}` : 'Copy failed';
              setTimeout(() => hideChartContextMenu(), 800);
            }, {
              once: true
            });
          }
        };

//PRICE ALERTS SYSTEM
        const parseAlertPrice = (raw) => {
          const v = parseFloat(String(raw || '').trim());
          return Number.isFinite(v) ? v : null;
        };
        const getAlertPrices = () => {
          const multiPrices = [];
          if (state.multiAlerts && state.multiAlerts.length) {
            const currentSym = (state.symbol || '').toUpperCase();
            for (const a of state.multiAlerts) {
              if (a && a.ticker) {
                const alertType = a.alertType || 'price';
                if (alertType !== 'price') continue;
                const threshold = a.threshold !== undefined ? a.threshold : a.price;
                const aSym = normalizeSymbol(a.ticker);
                if (aSym === currentSym && Number.isFinite(threshold)) {
                  multiPrices.push(threshold);
                }
              }
            }
          }
          return [...multiPrices];
        };
        const playAlertSound = () => {
          try {
            const ctx = state.audioContext || new(window.AudioContext || window.webkitAudioContext)();
            state.audioContext = ctx;
            const play = () => {
              const osc = ctx.createOscillator();
              const gain = ctx.createGain();
              osc.type = 'sine';
              osc.frequency.value = 1000;
              gain.gain.value = 0.1;
              osc.connect(gain);
              gain.connect(ctx.destination);
              const t = ctx.currentTime;
              osc.start(t);
              osc.stop(t + 0.3);
            };
            if (ctx.state === 'suspended') {
              ctx.resume().then(play).catch(() => {
                scheduleAudioUnlock(play);
              });
            } else {
              play();
            }
          } catch {}
        };
        let _pendingPlayFn = null;
        const scheduleAudioUnlock = (playFn) => {
          _pendingPlayFn = playFn;
          if (state._audioUnlockScheduled) return;
          state._audioUnlockScheduled = true;
          const handler = () => {
            state._audioUnlockScheduled = false;
            try {
              const fn = _pendingPlayFn;
              _pendingPlayFn = null;
              if (fn) {
                if (state.audioContext && state.audioContext.state === 'suspended') {
                  state.audioContext.resume().then(fn).catch(() => {});
                } else {
                  fn();
                }
              }
            } catch {}
            document.removeEventListener('click', handler);
            document.removeEventListener('keydown', handler);
            document.removeEventListener('touchstart', handler);
          };
          document.addEventListener('click', handler, {
            once: true
          });
          document.addEventListener('keydown', handler, {
            once: true
          });
          document.addEventListener('touchstart', handler, {
            once: true
          });
        };
        const ensureAudioContext = () => {
          try {
            const ctx = state.audioContext || new(window.AudioContext || window.webkitAudioContext)();
            state.audioContext = ctx;
            if (ctx.state === 'suspended') {
              ctx.resume().catch(() => {});
            }
          } catch {}
        };
        const showToast = (title, message, type) => {
          let container = document.getElementById('toastContainer');
          if (!container) {
            container = document.createElement('div');
            container.id = 'toastContainer';
            container.style.cssText =
              'position:fixed;top:16px;right:16px;z-index:9999;display:flex;flex-direction:column;gap:8px;pointer-events:none;max-width:360px;';
            document.body.appendChild(container);
          }
          if (container.children.length >= 5) return;
          const toast = document.createElement('div');
          const bgColor = type === 'up' ? 'rgba(14,203,129,0.92)' : 'rgba(242,54,69,0.92)';
          const borderColor = type === 'up' ? 'rgba(14,203,129,0.6)' : 'rgba(242,54,69,0.6)';
          toast.style.cssText = `
background:${bgColor};border:1px solid ${borderColor};border-radius:8px;
padding:10px 14px;color:#fff;font-size:0.9rem;box-shadow:0 8px 24px rgba(0,0,0,0.4);
pointer-events:auto;animation:toastIn 0.3s ease-out;backdrop-filter:blur(8px);
`;
          toast.innerHTML =
            `<div style="font-weight:700;margin-bottom:3px">${title}<\/div><div style="font-size:0.82rem;opacity:0.9">${message}<\/div>`;
          container.appendChild(toast);
          setTimeout(() => {
            toast.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
            toast.style.opacity = '0';
            toast.style.transform = 'translateX(20px)';
            setTimeout(() => toast.remove(), 300);
          }, 4000);
        };
        const requestNotificationPermission = () => {
          if ('Notification' in window && Notification.permission === 'default') {
            Notification.requestPermission().catch(() => {});
          }
        };
        const checkNotificationPermission = () => {
          if (!('Notification' in window)) return;
          if (Notification.permission === 'default') {
            const alertSection = document.querySelector('.alert-inputs');
            if (alertSection && !document.getElementById('enableNotifBtn')) {
              const btn = document.createElement('button');
              btn.id = 'enableNotifBtn';
              btn.type = 'button';
              btn.textContent = '🔔 Enable Notifications';
              btn.style.cssText =
                'font-size:0.75rem;padding:3px 8px;border-radius:4px;border:1px solid rgba(91,140,255,0.4);background:rgba(91,140,255,0.1);color:#5B8CFF;cursor:pointer;white-space:nowrap;';
              btn.addEventListener('click', () => {
                requestNotificationPermission();
                btn.remove();
              });
              alertSection.appendChild(btn);
            }
          } else if (Notification.permission === 'denied') {
            const alertSection = document.querySelector('.alert-inputs');
            if (alertSection && !document.getElementById('notifDeniedHint')) {
              const hint = document.createElement('span');
              hint.id = 'notifDeniedHint';
              hint.textContent = '🔔 Notifications blocked — enable in browser settings';
              hint.style.cssText = 'font-size:0.7rem;color:#9FA6AD;';
              alertSection.appendChild(hint);
            }
          }
        };
        const sendBrowserNotification = (title, body) => {
          try {
            if ('Notification' in window && Notification.permission === 'granted') {
              new Notification(title, {
                body: body,
                icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">ρ<\/text><\/svg>'
              });
            }
          } catch {}
        };

//Multi-Alert Background Monitor =====
        let _alertCheckInProgress = false;
        let _alertWsDebounce = null;
        const _alertRestCooldownMs = 5000;
        let _alertWorker = null;
        let _alertWorkerBlobUrl = null;
        let _alertWorkerSupported = false;
        const _initAlertWorker = () => {
          if (_alertWorker) return true;
          try {
            const workerCode = `
// Alert Timer Worker — provides unthrottled 1-second ticks
let _tickInterval=null;
self.onmessage=function(e) {
if (e.data.command==='start') {
if (_tickInterval) clearInterval(_tickInterval);
_tickInterval=setInterval(function() {
self.postMessage({ type: 'tick' });
}, e.data.interval || 1000);
} else if (e.data.command==='stop') {
if (_tickInterval) { clearInterval(_tickInterval); _tickInterval=null; }
}
};
`;
            const blob = new Blob([workerCode], {
              type: 'application/javascript'
            });
            _alertWorkerBlobUrl = URL.createObjectURL(blob);
            _alertWorker = new Worker(_alertWorkerBlobUrl);
            _alertWorker.onmessage = (e) => {
              if (e.data.type === 'tick') checkMultiAlerts();
            };
            _alertWorker.onerror = (err) => {
              console.warn('Alert Worker error, falling back to setInterval:', err);
              _alertWorker = null;
              _alertWorkerSupported = false;
              if (state._alertMonitorRunning) {
                if (state.alertTimer) clearInterval(state.alertTimer);
                state.alertTimer = setInterval(() => checkMultiAlerts(), 1000);
              }
            };
            _alertWorkerSupported = true;
            return true;
          } catch (err) {
            console.warn('Web Worker not available, falling back to setInterval:', err);
            _alertWorker = null;
            _alertWorkerSupported = false;
            return false;
          }
        };
        const _startAlertTimer = () => {
          if (_alertWorkerSupported && _alertWorker) {
            _alertWorker.postMessage({
              command: 'start',
              interval: 1000
            });
          } else {
            if (state.alertTimer) clearInterval(state.alertTimer);
            state.alertTimer = setInterval(() => checkMultiAlerts(), 1000);
          }
          state._alertMonitorRunning = true;
        };
        const _stopAlertTimer = () => {
          if (_alertWorkerSupported && _alertWorker) {
            _alertWorker.postMessage({
              command: 'stop'
            });
          }
          if (state.alertTimer) {
            clearInterval(state.alertTimer);
            state.alertTimer = null;
          }
          state._alertMonitorRunning = false;
        };
        const checkMultiAlerts = async () => {
          if (_alertCheckInProgress) return;
          _alertCheckInProgress = true;
          try {
            const alerts = state.multiAlerts;
            if (!alerts || alerts.length === 0) return;
            const now = Date.now();
            const cooldownMs = 3000;
            const mainSym = (state.symbol || '').toUpperCase();
            for (let i = 0; i < alerts.length; i++) {
              const alert = alerts[i];
              if (!alert || !alert.ticker) continue;
              const threshold = alert.threshold !== undefined ? alert.threshold : alert.price;
              if (!Number.isFinite(threshold)) continue;
              const sym = normalizeSymbol(alert.ticker);
              if (!sym) continue;
              const alertType = alert.alertType || 'price';
              const config = ALERT_TYPE_CONFIG[alertType];
              if (!config) continue;
              let currentValue = null;
              let source = 'rest';
              if (alertType === 'price') {
                if (sym === mainSym && Number.isFinite(state.currentPrice)) {
                  currentValue = state.currentPrice;
                  source = 'ws-main';
                } else if (state.alertWsData && state.alertWsData[sym] && Number.isFinite(state.alertWsData[sym]
                    .price)) {
                  currentValue = state.alertWsData[sym].price;
                  source = 'ws';
                }
              } else if (alertType === 'funding') {
                const fd = state.alertFundingData[sym];
                if (fd && Number.isFinite(fd.value) && (now - fd.lastUpdate < 10000)) {
                  currentValue = fd.value;
                  source = 'ws';
                }
              }
              if (!Number.isFinite(currentValue)) {
                const lastRest = alert._lastRestCall || 0;
                if (now - lastRest >= _alertRestCooldownMs) {
                  try {
                    const data = await fetchJsonWithTimeout(config.restUrl(sym));
                    currentValue = config.parseValue(data);
                    source = 'rest';
                    alert._lastRestCall = now;
                  } catch {
                    alert._lastError = now;
                    alert._errorCount = (alert._errorCount || 0) + 1;
                    continue;
                  }
                } else {
                  continue;
                }
              }
              if (!Number.isFinite(currentValue)) continue;
              alert._lastChecked = now;
              alert._lastSource = source;
              const prevValue = alert.lastValue;
              alert.lastValue = currentValue;
              alert._lastValueTime = Date.now();
              if (!Number.isFinite(prevValue)) continue;
              let crossedUp = false,
                crossedDown = false;
              if (alertType === 'funding') {
                const FUNDING_HYSTERESIS_PCT = 0.2;
                if (Number.isFinite(alert.threshold)) {
                  const hysteresisBand = Math.abs(alert.threshold) * FUNDING_HYSTERESIS_PCT;
                  if (alert._armedUp === false && currentValue < (alert.threshold - hysteresisBand)) {
                    alert._armedUp = true;
                  }
                  if (alert._armedDown === false && currentValue > (-alert.threshold + hysteresisBand)) {
                    alert._armedDown = true;
                  }
                  if (alert._armedUp === undefined) alert._armedUp = true;
                  if (alert._armedDown === undefined) alert._armedDown = true;
                }
                if (alert._armedUp && prevValue < threshold && currentValue >= threshold) {
                  crossedUp = true;
                  alert._armedUp = false;
                }
                if (prevValue >= threshold && currentValue < threshold) crossedDown = true;
                if (alert._armedDown && prevValue > -threshold && currentValue <= -threshold) {
                  crossedDown = true;
                  alert._armedDown = false;
                }
                if (prevValue <= -threshold && currentValue > -threshold) crossedUp = true;
              } else {
                crossedUp = prevValue < threshold && currentValue >= threshold;
                crossedDown = prevValue > threshold && currentValue <= threshold;
              }
              if (!crossedUp && !crossedDown) continue;
              const lastT = alert.lastTriggered || 0;
              if (now - lastT < cooldownMs) continue;
              alert.lastTriggered = now;
              alert._errorCount = 0;
              saveMultiAlerts(state.multiAlerts);
              if (alertType === 'price') {
                state.alertPrices[sym] = currentValue;
              }
              playAlertSound();
              const ticker = sym.replace('USDT', '');
              const typeLabel = config.label;
              const thresholdStr = config.formatThreshold(threshold);
              const currentStr = config.formatValue(currentValue);
              if (crossedUp) {
                showToast(`${ticker} ${typeLabel} ↑`, `Crossed UP ${thresholdStr} (now ${currentStr})`, 'up');
                sendBrowserNotification(`${ticker} ${typeLabel}`, `Crossed UP ${thresholdStr} (now ${currentStr})`);
                updateAlertLog(i + 1, `${ticker} ${typeLabel}: Crossed UP ${thresholdStr}`);
              } else {
                showToast(`${ticker} ${typeLabel} ↓`, `Crossed DOWN ${thresholdStr} (now ${currentStr})`, 'down');
                sendBrowserNotification(`${ticker} ${typeLabel}`,
                  `Crossed DOWN ${thresholdStr} (now ${currentStr})`);
                updateAlertLog(i + 1, `${ticker} ${typeLabel}: Crossed DOWN ${thresholdStr}`);
              }
            }
            renderAlertLiveStatus();
            renderAlertRtPrices();
          } finally {
            _alertCheckInProgress = false;
          }
        };
        const startMultiAlertMonitor = () => {
          _stopAlertTimer();
          _initAlertWorker();
          _startAlertTimer();
          checkMultiAlerts();
          if (state._wsAlreadyConnecting) {
            state._wsAlreadyConnecting = false;
          } else {
            reconnectPrimaryWs();
          }
          renderAlertLiveStatus();
        };
        const stopMultiAlertMonitor = () => {
          _stopAlertTimer();
          state.alertWsData = {};
          state.alertFundingData = {};
          renderAlertLiveStatus();
        };
        const formatAlertLogEntry = (entry) => {
          return entry.replace(/^(\w+):/, '<span style="color:#F3A052;font-weight:700;">$1<\/span>:').replace(
            /Crossed DOWN/g, '<span style="color:#F23645;font-weight:700;">Crossed DOWN<\/span>').replace(
            /Crossed UP/g, '<span style="color:#26D4AC;font-weight:700;">Crossed UP<\/span>');
        };
        const updateAlertLog = (slotIndex, message) => {
          const now = new Date().toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
            hour12: true
          });
          const entry = `${message} at ${now}`;
          state.alertLog[slotIndex] = entry;
          saveAlertLogHistory(state.alertLog);
          const logEl = document.getElementById(`alertLog${slotIndex}`);
          if (logEl) {
            logEl.innerHTML = formatAlertLogEntry(entry);
            logEl.title = `Last: ${entry}`;
          }
        };
        const restoreAlertLogUI = () => {
          for (let i = 1; i <= 4; i++) {
            const logEl = document.getElementById(`alertLog${i}`);
            if (!logEl) continue;
            const entry = state.alertLog[i];
            if (entry) {
              logEl.innerHTML = formatAlertLogEntry(entry);
              logEl.title = `Last: ${entry}`;
            } else {
              logEl.innerHTML = '';
              logEl.title = '';
            }
          }
        };
        const renderAlertLiveStatus = () => {
          const alerts = state.multiAlerts;
          const isMonitorRunning = state._alertMonitorRunning;
          const isWsDown = state.wsStatus.level === 'error';
          const now = Date.now();
          for (let i = 0; i < 4; i++) {
            const liveEl = document.getElementById(`alertLive${i + 1}`);
            const loadBtn = document.getElementById(`alertLoad${i + 1}`);
            const cardEl = document.getElementById(`alertSlot${i + 1}`);
            if (!liveEl || !loadBtn) continue;
            const alert = alerts[i];
            const hasAlert = alert && alert.ticker && (Number.isFinite(alert.threshold) || Number.isFinite(alert
              .price));
            const hasRecentError = alert && alert._lastError && (now - alert._lastError < 10000);
            const hasRepeatedErrors = alert && (alert._errorCount || 0) >= 3;
            const setCardStatus = (status) => {
              if (!cardEl) return;
              cardEl.classList.remove('status-active', 'status-error', 'status-warning', 'status-idle');
              if (status) cardEl.classList.add('status-' + status);
            };
            if (hasAlert && isMonitorRunning && isWsDown) {
              liveEl.className = 'alert-live-status error';
              liveEl.innerHTML = '<span class="alert-live-dot"><\/span>Offline';
              loadBtn.disabled = false;
              setCardStatus('error');
            } else if (hasAlert && isMonitorRunning && hasRepeatedErrors) {
              liveEl.className = 'alert-live-status warning';
              liveEl.innerHTML = `<span class="alert-live-dot"><\/span>Retrying (${alert._errorCount})`;
              liveEl.title =
                `Last error: ${new Date(alert._lastError).toLocaleTimeString()} — REST calls failing, will keep retrying`;
              loadBtn.disabled = false;
              setCardStatus('warning');
            } else if (hasAlert && isMonitorRunning && hasRecentError) {
              liveEl.className = 'alert-live-status warning';
              liveEl.innerHTML = '<span class="alert-live-dot"><\/span>Retrying';
              liveEl.title =
              `Last error at ${new Date(alert._lastError).toLocaleTimeString()} — monitoring continues`;
              loadBtn.disabled = false;
              setCardStatus('warning');
            } else if (hasAlert && isMonitorRunning) {
              const src = alert._lastSource || 'rest';
              const sourceLabel = src.startsWith('ws') ? '' : '- Working..';
              liveEl.className = 'alert-live-status active';
              liveEl.innerHTML = `<span class="alert-live-dot"><\/span>Active ${sourceLabel}`;
              liveEl.title = `Monitoring via ${sourceLabel==='WS' ? 'WebSocket (real-time)' : 'REST polling (1s)'}`;
              loadBtn.disabled = false;
              setCardStatus('active');
            } else if (hasAlert && !isMonitorRunning) {
              liveEl.className = 'alert-live-status error';
              liveEl.innerHTML = '<span class="alert-live-dot"><\/span>Off';
              loadBtn.disabled = false;
              setCardStatus('error');
            } else {
              liveEl.className = 'alert-live-status idle';
              liveEl.innerHTML = '<span class="alert-live-dot"><\/span>Idle';
              loadBtn.disabled = true;
              setCardStatus('idle');
            }
          }
        };
        const renderAlertSlots = () => {
          const alerts = state.multiAlerts;
          const activeEl = document.activeElement;
          for (let i = 0; i < 4; i++) {
            const tickerInput = document.getElementById(`alertTicker${i + 1}`);
            const typeSelect = document.getElementById(`alertType${i + 1}`);
            const priceInput = document.getElementById(`alertPrice${i + 1}`);
            if (!tickerInput || !priceInput) continue;
            const isEditingThisSlot = (activeEl === tickerInput || activeEl === typeSelect || activeEl ===
            priceInput);
            if (isEditingThisSlot) continue;
            if (alerts[i] && !alerts[i]._pendingRemoval && alerts[i].ticker) {
              tickerInput.value = alerts[i].ticker.replace('USDT', '');
              const alertType = alerts[i].alertType || 'price';
              if (typeSelect) typeSelect.value = alertType;
              priceInput.value = alerts[i].threshold !== undefined ? alerts[i].threshold : alerts[i].price;
              const config = ALERT_TYPE_CONFIG[alertType];
              if (config) priceInput.placeholder = config.placeholder;
            } else {
              tickerInput.value = '';
              if (typeSelect) typeSelect.value = 'price';
              priceInput.value = '';
              priceInput.placeholder = 'Price';
            }
          }
          renderAlertLiveStatus();
          renderAlertRtPrices();
          checkNotificationPermission();
        };
        const renderAlertRtPrices = () => {
          const alerts = state.multiAlerts;
          for (let i = 0; i < 4; i++) {
            const rtEl = document.getElementById(`alertRtPrice${i + 1}`);
            if (!rtEl) continue;
            const alert = alerts[i];
            if (!alert || !alert.ticker || alert._pendingRemoval) {
              rtEl.textContent = '--';
              rtEl.className = 'alert-rt-price empty';
              continue;
            }
            const sym = alert.ticker;
            const alertType = alert.alertType || 'price';
            const config = ALERT_TYPE_CONFIG[alertType];
            let value = null;
            if (alertType === 'price') {
              if (sym === (state.symbol || '').toUpperCase() && Number.isFinite(state.currentPrice)) {
                value = state.currentPrice;
              } else if (state.alertWsData && state.alertWsData[sym] && Number.isFinite(state.alertWsData[sym]
                .price)) {
                value = state.alertWsData[sym].price;
              } else if (state.alertPrices && Number.isFinite(state.alertPrices[sym])) {
                value = state.alertPrices[sym];
              }
            } else if (alertType === 'funding') {
              const fd = state.alertFundingData[sym];
              if (fd && Number.isFinite(fd.value)) value = fd.value;
            }
            if (!Number.isFinite(value)) {
              rtEl.textContent = '--';
              rtEl.className = 'alert-rt-price empty';
            } else {
              rtEl.textContent = config.formatValue(value);
              const threshold = alert.threshold !== undefined ? alert.threshold : alert.price;
              if (alertType === 'price') {
                rtEl.className = value >= threshold ? 'alert-rt-price price-up' : 'alert-rt-price price-down';
              } else {
                rtEl.className = value >= 0 ? 'alert-rt-price price-up' : 'alert-rt-price price-down';
              }
            }
          }
        };
        const removeMultiAlert = (index) => {
          if (index < 0 || index >= 4) return;
          if (state._removeInProgress === index) return;
          state._removeInProgress = index;
          try {
            if (index < state.multiAlerts.length) {
              state.multiAlerts[index] = null;
            }
            while (state.multiAlerts.length > 0 && state.multiAlerts[state.multiAlerts.length - 1] === null) {
              state.multiAlerts.pop();
            }
            const removedSlot = index + 1;
            delete state.alertLog[removedSlot];
            saveAlertLogHistory(state.alertLog);
            saveMultiAlerts(state.multiAlerts);
            renderAlertSlots();
            restoreAlertLogUI();
            const hasActive = state.multiAlerts.some(a => a && a.ticker && (Number.isFinite(a.threshold) || Number
              .isFinite(a.price)));
            if (!hasActive) stopMultiAlertMonitor();
          } finally {
            state._removeInProgress = null;
          }
        };
        const updateMultiAlert = (index, ticker, price, alertType = 'price') => {
          const sym = normalizeSymbol(ticker);
          const p = parseAlertPrice(price);
          const type = alertType || 'price';
          if (sym && Number.isFinite(p)) {
            while (state.multiAlerts.length <= index && state.multiAlerts.length < 4) {
              state.multiAlerts.push(null);
            }
            if (index < 4) {
              state.multiAlerts[index] = {
                ticker: sym,
                alertType: type,
                threshold: p,
                lastTriggered: state.multiAlerts[index]?.lastTriggered || 0,
                lastValue: null
              };
              saveMultiAlerts(state.multiAlerts);
              renderAlertSlots();
              clearTimeout(_alertWsDebounce);
              _alertWsDebounce = setTimeout(() => startMultiAlertMonitor(), 500);
            }
            return;
          }
          const hasTicker = ticker && String(ticker).trim().length > 0;
          const hasPrice = price && String(price).trim().length > 0;
          if (hasTicker || hasPrice) {
            return;
          }
          if (index < state.multiAlerts.length && state.multiAlerts[index] !== null) {
            state.multiAlerts[index] = null;
            while (state.multiAlerts.length > 0 && state.multiAlerts[state.multiAlerts.length - 1] === null) {
              state.multiAlerts.pop();
            }
            saveMultiAlerts(state.multiAlerts);
            renderAlertSlots();
            const hasActive = state.multiAlerts.some(a => a && a.ticker && (Number.isFinite(a.threshold) || Number
              .isFinite(a.price)));
            if (!hasActive) stopMultiAlertMonitor();
          }
        };
        const fetchWithTimeout = async (url, timeoutMs) => {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), timeoutMs);
          try {
            const res = await fetch(url, {
              signal: controller.signal
            });
            return res;
          } finally {
            clearTimeout(timeout);
          }
        };

//Binance API Error Detection
        const _binanceErrorState = {
          http429Count: 0,
          http418Time: null,
          http451Time: null,
          wsConsecutiveFails: 0,
          lastWarningTime: 0,
          warningBarVisible: false,
        };
        const _restRetryState = new Map();
        const showBinanceWarning = (title, message, type) => {
          const now = Date.now();
          if (now - _binanceErrorState.lastWarningTime < 30000) return;
          _binanceErrorState.lastWarningTime = now;
          showToast(title, message, type);
        };
        const showBinanceWarningBar = (text, linkUrl, linkText) => {
          let bar = document.getElementById('binanceWarningBar');
          if (!bar) {
            bar = document.createElement('div');
            bar.id = 'binanceWarningBar';
            bar.style.cssText = `
position:fixed;top:0;left:0;right:0;z-index:10000;
background:linear-gradient(135deg,rgba(229,72,76,0.95),rgba(180,40,45,0.95));
color:#fff;padding:10px 16px;font-size:0.85rem;text-align:center;
box-shadow:0 2px 12px rgba(0,0,0,0.4);display:flex;align-items:center;
justify-content:center;gap:10px;backdrop-filter:blur(8px);
animation:warningBarSlide 0.3s ease-out;
`;
            if (!document.getElementById('warningBarStyle')) {
              const style = document.createElement('style');
              style.id = 'warningBarStyle';
              style.textContent = `
@keyframes warningBarSlide { from { transform:translateY(-100%); } to { transform:translateY(0); } }
#binanceWarningBar a { color:#FDE68A; text-decoration:underline; font-weight:600; }
#binanceWarningBar a:hover { color:#FEF3C7; }
#binanceWarningBar .warning-close { cursor:pointer; margin-left:12px; font-size:1.1rem;
opacity:0.7; transition:opacity 0.2s; }
#binanceWarningBar .warning-close:hover { opacity:1; }
`;
              document.head.appendChild(style);
            }
            document.body.appendChild(bar);
            document.body.style.paddingTop = '44px';
          }
          bar.textContent = '';
          bar.appendChild(document.createTextNode(text + ' '));
          if (linkUrl && linkText) {
            const a = document.createElement('a');
            a.href = linkUrl;
            a.textContent = linkText;
            a.target = '_blank';
            a.rel = 'noopener';
            bar.appendChild(a);
            bar.appendChild(document.createTextNode(' '));
          }
          const close = document.createElement('span');
          close.className = 'warning-close';
          close.textContent = '×';
          close.addEventListener('click', () => {
            bar.style.display = 'none';
            document.body.style.paddingTop = '0';
          });
          bar.appendChild(close);
          bar.style.display = 'flex';
          _binanceErrorState.warningBarVisible = true;
        };
        const hideBinanceWarningBar = () => {
          const bar = document.getElementById('binanceWarningBar');
          if (bar) bar.style.display = 'none';
          document.body.style.paddingTop = '0';
          _binanceErrorState.warningBarVisible = false;
        };
        const fetchJsonWithTimeout = async (url) => {
          const urlPattern = url.split('?')[0];
          const retryState = _restRetryState.get(urlPattern);
          if (retryState && Date.now() < retryState.nextRetryTime) {
            const waitSec = Math.ceil((retryState.nextRetryTime - Date.now()) / 1000);
            throw new Error(`Rate limited — retry in ${waitSec}s`);
          }
          if (retryState && Date.now() >= retryState.nextRetryTime && retryState.attemptCount > 0) {
            _restRetryState.delete(urlPattern);
          }
          const res = await fetchWithTimeout(url, CONFIG.FETCH_TIMEOUT_MS);
          if (!res.ok) {
            if (res.status === 429) {
              _binanceErrorState.http429Count++;
              showBinanceWarning('API Rate Limited',
                'Binance is throttling REST requests from your IP. Slow down or close other Binance tabs.', 'down'
                );
              showBinanceWarningBar(
                '⚠️ Binance API rate limit hit (429). Too many REST requests from your IP. Slow down or close other Binance tabs.',
                'https://x.com/MultiPerps', 'Report on X @MultiPerps');
              const existingRetry = _restRetryState.get(urlPattern) || {
                attemptCount: 0
              };
              existingRetry.attemptCount += 1;
              existingRetry.nextRetryTime = Date.now() + (Math.pow(2, existingRetry.attemptCount) * 1000);
              _restRetryState.set(urlPattern, existingRetry);
            } else if (res.status === 418) {
              _binanceErrorState.http418Time = Date.now();
              showBinanceWarning('IP Temporarily Banned',
                'Binance has temporarily banned your IP. This usually auto-resolves in 1-2 hours.', 'down');
              showBinanceWarningBar(
                '🚫 Your IP has been temporarily banned by Binance (418). This auto-resolves in 1-2 hours. Close all other Binance tabs/apps.',
                'https://x.com/MultiPerps', 'Report on X @MultiPerps');
            } else if (res.status === 451) {
              _binanceErrorState.http451Time = Date.now();
              showBinanceWarning('Region Restricted',
                'Binance API is not available in your region (451). Consider using a VPN.', 'down');
              showBinanceWarningBar(
                '🌍 Binance API is restricted in your region (451). You may need a VPN to access market data.',
                'https://x.com/MultiPerps', 'Report on X @MultiPerps');
            }
            throw new Error(`HTTP ${res.status}`);
          }
          if (_binanceErrorState.warningBarVisible && !_binanceErrorState.http418Time) {
            hideBinanceWarningBar();
          }
          return res.json();
        };
        const formatPct = (value) => {
          if (!Number.isFinite(value)) return '';
          const sign = value > 0 ? '+' : '';
          return `${sign}${value.toFixed(2)}%`;
        };
        const loadFuturesSymbolsFromCache = () => {
          try {
            const raw = localStorage.getItem(STORAGE.futuresSymbolsCache);
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            if (!parsed || !Number.isFinite(parsed.savedAt)) return null;
            if (Date.now() - parsed.savedAt > CONFIG.FUTURES_SYMBOLS_CACHE_TTL_MS) return null;
            if (Array.isArray(parsed.items)) return parsed.items;
            if (Array.isArray(parsed.symbols)) {
              return parsed.symbols.map((t) => ({
                ticker: String(t || '').toUpperCase(),
                pct: null,
                volUsdt: null,
              })).filter((x) => x.ticker);
            }
            return null;
          } catch {
            return null;
          }
        };
        const saveFuturesSymbolsToCache = (items) => {
          try {
            safeLocalStorageSet(STORAGE.futuresSymbolsCache, JSON.stringify({
              savedAt: Date.now(),
              items
            }));
          } catch {}
        };
        const fetchFuturesUsdtPerpSymbols = async () => {
          const data = await fetchJsonWithTimeout(CONFIG.FUTURES_EXCHANGE_INFO_URL);
          const list = Array.isArray(data?.symbols) ? data.symbols : [];
          const out = [];
          for (const s of list) {
            if (!s || s.status !== 'TRADING') continue;
            if (s.contractType === 'CURRENT_QUARTER' || s.contractType === 'NEXT_QUARTER') continue;
            if (s.quoteAsset !== 'USDT') continue;
            const sym = String(s.symbol || '').toUpperCase();
            if (!sym.endsWith('USDT')) continue;
            out.push(sym);
          }
          out.sort((a, b) => a.localeCompare(b));
          return Array.from(new Set(out));
        };
        const fetchFutures24hStatsBySymbol = async () => {
          const data = await fetchJsonWithTimeout('https://fapi.binance.com/fapi/v1/ticker/24hr');
          const list = Array.isArray(data) ? data : [];
          const out = new Map();
          for (const t of list) {
            const sym = String(t?.symbol || '').toUpperCase();
            if (!sym) continue;
            const pct = Number.parseFloat(t?.priceChangePercent);
            const quoteVol = Number.parseFloat(t?.quoteVolume);
            const lastPrice = Number.parseFloat(t?.lastPrice);
            const vol = Number.parseFloat(t?.volume);
            out.set(sym, {
              pct: Number.isFinite(pct) ? pct : null,
              volUsdt: Number.isFinite(quoteVol) ? quoteVol : null,
              lastPrice: Number.isFinite(lastPrice) ? lastPrice : null,
              volume: Number.isFinite(vol) ? vol : 0,
            });
          }
          return out;
        };
        const ensureTickerSuggestMenu = () => {
          let menu = document.getElementById('tickerSuggestMenu');
          if (!menu) {
            menu = document.createElement('div');
            menu.id = 'tickerSuggestMenu';
            menu.className = 'ticker-suggest-menu';
            menu.innerHTML = `
          <div class="ticker-suggest-filters">
            <button type="button" class="ticker-suggest-filter-btn" data-filter="all">All</button>
            <button type="button" class="ticker-suggest-filter-btn" data-filter="recent">Recent</button>
            <button type="button" class="ticker-suggest-filter-btn" data-filter="favorites">Fav</button>
            <button type="button" class="ticker-suggest-filter-btn" data-filter="gainers">Gainers</button>
            <button type="button" class="ticker-suggest-filter-btn" data-filter="losers">Losers</button>
            <button type="button" class="ticker-suggest-filter-btn clear" data-action="clear">Clear</button>
          </div>
          <div class="ticker-suggest-list" id="tickerSuggestList"></div>
`;
            document.body.appendChild(menu);
            menu.addEventListener('mousedown', (e) => {
              state.tickerSuggest.ignoreBlurUntil = Date.now() + 800;
              e.preventDefault();
            });
            menu.addEventListener('mouseenter', () => {
              state.tickerSuggest.ignoreBlurUntil = Date.now() + 2000;
            });
            menu.addEventListener('mouseleave', () => {
              state.tickerSuggest.ignoreBlurUntil = Date.now() + 300;
            });
            let touchStartY = 0;
            let touchStartX = 0;
            menu.addEventListener('touchstart', (e) => {
              state.tickerSuggest.ignoreBlurUntil = Date.now() + 2000;
              touchStartY = e.touches[0].clientY;
              touchStartX = e.touches[0].clientX;
            }, {
              passive: true
            });
            menu.addEventListener('touchmove', (e) => {
              const dy = e.touches[0].clientY - touchStartY;
              const dx = e.touches[0].clientX - touchStartX;
              if (dy > 80 || Math.abs(dx) > 120) {
                hideTickerSuggestMenu();
              }
            }, {
              passive: true
            });
            const filterRow = menu.querySelector('.ticker-suggest-filters');
            if (filterRow) {
              filterRow.addEventListener('click', (e) => {
                const actionBtn = e.target?.closest?.('[data-action]');
                const action = actionBtn?.getAttribute?.('data-action');
                if (action === 'clear') {
                  const targetInput = state.tickerSuggest.activeInput || state.elements.tickerInput;
                  if (!targetInput) return;
                  targetInput.value = '';
                  if (targetInput === state.elements.tickerInput) saveStored(STORAGE.tickerInput, '');
                  targetInput.focus();
                  renderTickerSuggestMenu();
                  return;
                }
                const btn = e.target?.closest?.('.ticker-suggest-filter-btn');
                const f = btn?.getAttribute?.('data-filter');
                if (!f) return;
                state.tickerSuggest.filter = f;
                renderTickerSuggestMenu();
              });
            }
            document.addEventListener('click', (e) => {
              const target = e.target;
              if (target && state.elements.tickerInput && (target === state.elements.tickerInput || state.elements
                  .tickerInput.contains(target))) return;
              if (target && state.tickerSuggest.activeInput && (target === state.tickerSuggest.activeInput ||
                  state.tickerSuggest.activeInput.contains(target))) return;
              if (target && menu.contains(target)) return;
              hideTickerSuggestMenu();
            });
            document.addEventListener('keydown', (e) => {
              if (e.key === 'Escape') hideTickerSuggestMenu();
            });
            window.addEventListener('blur', () => hideTickerSuggestMenu());
          }
          return menu;
        };
        const hideTickerSuggestMenu = () => {
          const menu = document.getElementById('tickerSuggestMenu');
          if (menu) menu.style.display = 'none';
          state.tickerSuggest.visible = false;
          state.tickerSuggest.activeIndex = -1;
          state.tickerSuggest.items = [];
        };
        const renderTickerSuggestMenu = () => {
          const targetInput = state.tickerSuggest.activeInput || state.elements.tickerInput;
          if (!targetInput) return;
          const query = String(targetInput.value || '').trim().toUpperCase();
          const items = state.futuresTickerItems;
          if (!items || items.length === 0) {
            hideTickerSuggestMenu();
            return;
          }
          let base = items;
          if (state.tickerSuggest.filter === 'recent') {
            const recent = loadRecentTickers();
            base = recent.map(t => items.find(x => x.ticker === t || x.ticker === t.replace('USDT', ''))).filter(
              Boolean);
            if (base.length === 0) {
              base = [];
            }
          } else if (state.tickerSuggest.filter === 'favorites') {
            base = items.filter((x) => isFavoriteTicker(x.ticker));
          } else if (state.tickerSuggest.filter === 'gainers') {
            base = items.filter((x) => Number.isFinite(x.pct)).slice().sort((a, b) => (b.pct - a.pct));
          } else if (state.tickerSuggest.filter === 'losers') {
            base = items.filter((x) => Number.isFinite(x.pct)).slice().sort((a, b) => (a.pct - b.pct));
          } else {
            base = items.slice().sort((a, b) => {
              const af = isFavoriteTicker(a.ticker) ? 1 : 0;
              const bf = isFavoriteTicker(b.ticker) ? 1 : 0;
              if (af !== bf) return bf - af;
              return a.ticker.localeCompare(b.ticker);
            });
          }
          const filtered = query ? base.filter((x) => x.ticker.includes(query)) : base;
          const top = filtered.slice(0, state.tickerSuggest.filter === 'all' ? 100 : 30);
          state.tickerSuggest.items = top;
          state.tickerSuggest.activeIndex = top.length ? 0 : -1;
          const menu = ensureTickerSuggestMenu();
          const filterBtns = Array.from(menu.querySelectorAll('.ticker-suggest-filter-btn'));
          for (const b of filterBtns) {
            b.classList.toggle('active', b.getAttribute('data-filter') === state.tickerSuggest.filter);
          }
          const listEl = menu.querySelector('#tickerSuggestList');
          if (!listEl) return;
          listEl.innerHTML = '';
          if (!top.length) {
            const empty = document.createElement('div');
            empty.className = 'ticker-suggest-item placeholder';
            if (state.tickerSuggest.filter === 'favorites') {
              empty.textContent = 'No favorites yet. Click ★ to save.';
            } else if (state.tickerSuggest.filter === 'recent') {
              empty.textContent = 'No recent tickers. Search and select a ticker to build history.';
            } else {
              empty.textContent = 'No matches.';
            }
            listEl.appendChild(empty);
          }
          for (let i = 0; i < top.length; i++) {
            const it = top[i];
            const row = document.createElement('div');
            row.className = 'ticker-suggest-item' + (i === state.tickerSuggest.activeIndex ? ' active' : '');
            const left = document.createElement('div');
            left.className = 'ticker-suggest-left';
            const star = document.createElement('button');
            star.type = 'button';
            star.className = 'ticker-suggest-star' + (isFavoriteTicker(it.ticker) ? ' fav' : '');
            star.textContent = isFavoriteTicker(it.ticker) ? '★' : '☆';
            star.addEventListener('click', (e) => {
              e.preventDefault();
              e.stopPropagation();
              toggleFavoriteTicker(it.ticker);
              renderTickerSuggestMenu();
            });
            const symbol = document.createElement('span');
            symbol.textContent = it.ticker;
            left.appendChild(star);
            left.appendChild(symbol);
            const right = document.createElement('div');
            const pctText = Number.isFinite(it.pct) ? formatPct(it.pct) : '';
            const volText = Number.isFinite(it.volUsdt) ? formatUsdtVolume(it.volUsdt) : '';
            const metaText = pctText || volText ? `(${[pctText, volText].filter(Boolean).join(', ')})` : '';
            right.className = 'ticker-suggest-right' + (Number.isFinite(it.pct) ? (it.pct > 0 ? ' up' : (it.pct < 0 ?
              ' down' : '')) : '');
            right.textContent = metaText;
            row.appendChild(left);
            row.appendChild(right);
            row.addEventListener('mousedown', (e) => {
              e.preventDefault();
            });
            row.addEventListener('click', async () => {
              const next = normalizeSymbol(it.ticker);
              addRecentTicker(next || it.ticker);
              if (state.tickerSuggest.onSelectCallback) {
                targetInput.value = it.ticker;
                hideTickerSuggestMenu();
                state.tickerSuggest.onSelectCallback(it.ticker, next);
              } else {
                state.elements.tickerInput.value = it.ticker;
                saveStored(STORAGE.tickerInput, it.ticker);
                hideTickerSuggestMenu();
                if (next && next !== state.symbol) await loadSymbol(it.ticker);
              }
            });
            listEl.appendChild(row);
          }
          const rect = targetInput.getBoundingClientRect();
          const pad = 8;
          menu.style.width = `${Math.max(220, rect.width)}px`;
          menu.style.display = 'block';
          const mrect = menu.getBoundingClientRect();
          const maxLeft = window.innerWidth - mrect.width - pad;
          const maxTop = window.innerHeight - mrect.height - pad;
          let left = rect.left + rect.width / 2 - mrect.width / 2;
          left = Math.max(pad, Math.min(left, maxLeft));
          const gap = 8;
          let topPx = rect.bottom + gap;
          if (topPx + mrect.height > window.innerHeight - pad) {
            topPx = rect.top - gap - mrect.height;
          }
          topPx = Math.max(pad, Math.min(topPx, maxTop));
          menu.style.left = `${left}px`;
          menu.style.top = `${topPx}px`;
          state.tickerSuggest.visible = true;
        };
// FALLBACK TICKER LIST (Binance USDT-M Perpetuals)
        const FALLBACK_TICKERS = ["BTCUSDT", "ETHUSDT"];
        const buildFallbackTickerItems = () => {
          return FALLBACK_TICKERS.map(ticker => ({
            ticker: ticker.replace('USDT', ''),
            pct: null,
            volUsdt: null
          }));
        };
        const initTickerAutocomplete = async () => {
          const cached = loadFuturesSymbolsFromCache();
          if (cached && cached.length) {
            state.futuresTickerItems = cached;
          } else {
            state.futuresTickerItems = buildFallbackTickerItems();
          }
          let datalist = document.getElementById('alertTickerDatalist');
          if (!datalist) {
            datalist = document.createElement('datalist');
            datalist.id = 'alertTickerDatalist';
            document.body.appendChild(datalist);
          }
          datalist.innerHTML = state.futuresTickerItems.map(it => `<option value="${it.ticker}">`).join('');
          for (let i = 1; i <= 4; i++) {
            const inp = document.getElementById(`alertTicker${i}`);
            if (inp) {
              inp.setAttribute('list', 'alertTickerDatalist');
              inp.setAttribute('autocomplete', 'off');
            }
          }
          for (let i = 0; i < MAX_TRACKERS; i++) {
            const inp = document.getElementById(`trackerInput${i}`);
            if (inp) {
              inp.setAttribute('list', 'alertTickerDatalist');
              inp.setAttribute('autocomplete', 'off');
            }
          }
          try {
            const symbols = await fetchFuturesUsdtPerpSymbols();
            const stats = await fetchFutures24hStatsBySymbol();
            const items = symbols.map((sym) => {
              const t = toDisplayTicker(sym);
              const st = stats.get(sym);
              return {
                ticker: t,
                pct: st?.pct ?? null,
                volUsdt: st?.volUsdt ?? null,
              };
            }).filter((x) => x.ticker);
            items.sort((a, b) => a.ticker.localeCompare(b.ticker));
            if (items.length) {
              state.futuresTickerItems = items;
              saveFuturesSymbolsToCache(items);
              let datalist = document.getElementById('alertTickerDatalist');
              if (!datalist) {
                datalist = document.createElement('datalist');
                datalist.id = 'alertTickerDatalist';
                document.body.appendChild(datalist);
              }
              datalist.innerHTML = items.map(it => `<option value="${it.ticker}">`).join('');
              for (let i = 1; i <= 4; i++) {
                const inp = document.getElementById(`alertTicker${i}`);
                if (inp) {
                  inp.setAttribute('list', 'alertTickerDatalist');
                  inp.setAttribute('autocomplete', 'off');
                }
              }
              for (let i = 0; i < MAX_TRACKERS; i++) {
                const inp = document.getElementById(`trackerInput${i}`);
                if (inp) {
                  inp.setAttribute('list', 'alertTickerDatalist');
                  inp.setAttribute('autocomplete', 'off');
                }
              }
            }
          } catch (err) {}
        };
        const moveTickerSuggestActive = (delta) => {
          const menu = document.getElementById('tickerSuggestMenu');
          const listEl = menu?.querySelector('#tickerSuggestList');
          const items = state.tickerSuggest.items;
          if (!menu || !listEl || !state.tickerSuggest.visible || !items.length) return;
          const next = Math.max(0, Math.min(items.length - 1, state.tickerSuggest.activeIndex + delta));
          state.tickerSuggest.activeIndex = next;
          const rows = Array.from(listEl.querySelectorAll('.ticker-suggest-item'));
          for (let i = 0; i < rows.length; i++) {
            rows[i].classList.toggle('active', i === next);
          }
          const row = rows[next];
          if (row) row.scrollIntoView({
            block: 'nearest'
          });
        };
        const acceptTickerSuggestActive = () => {
          const items = state.tickerSuggest.items;
          const idx = state.tickerSuggest.activeIndex;
          if (!state.tickerSuggest.visible || !items.length || idx < 0 || idx >= items.length) return false;
          const it = items[idx];
          if (!it || !it.ticker) return false;
          const targetInput = state.tickerSuggest.activeInput || state.elements.tickerInput;
          if (targetInput) targetInput.value = it.ticker;
          if (state.tickerSuggest.onSelectCallback) {
            const next = normalizeSymbol(it.ticker);
            state.tickerSuggest.onSelectCallback(it.ticker, next);
          } else {
            saveStored(STORAGE.tickerInput, it.ticker);
          }
          renderTickerSuggestMenu();
          return true;
        };
//KLINE DATA FETCHING
        const fetchCurrentPrice = async (symbol) => {
          try {
            // Fetch both price and 24h stats in one call
            const data = await fetchJsonWithTimeout(
              `https://fapi.binance.com/fapi/v1/ticker/24hr?symbol=${encodeURIComponent(symbol)}`);
            const price = parseFloat(data?.lastPrice);
            const pct = parseFloat(data?.priceChangePercent);
            const vol = parseFloat(data?.quoteVolume);
            if (Number.isFinite(price)) {
              state.currentPrice = price;
              state.lastTradeTime = Date.now();

              updatePriceUI();
              renderAlertRtPrices();
            }
          } catch {
            // Fallback to price-only endpoint
            try {
              const data = await fetchJsonWithTimeout(
                `https://fapi.binance.com/fapi/v1/ticker/price?symbol=${encodeURIComponent(symbol)}`);
              const price = parseFloat(data?.price);
              if (Number.isFinite(price)) {
                state.currentPrice = price;
                state.lastTradeTime = Date.now();
                updatePriceUI();
                renderAlertRtPrices();
              }
            } catch {}
          }
        };
        const fetchBinanceFuturesKlines = async (symbol, interval, limit) => {
          const url =
            `https://fapi.binance.com/fapi/v1/klines?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}&limit=${encodeURIComponent(limit)}`;
          const data = await fetchJsonWithTimeout(url);
          return data.map((k) => ({
            openTime: k[0],
            open: parseFloat(k[1]),
            high: parseFloat(k[2]),
            low: parseFloat(k[3]),
            close: parseFloat(k[4]),
            volume: parseFloat(k[5]),
            quoteVolume: parseFloat(k[7]),
            closeTime: k[6],
          }));
        };
        const fetchExchangeKlines = fetchBinanceFuturesKlines;
        const resizeCanvasToContainer = (canvas) => {
          const dpr = window.devicePixelRatio || 1;
          const rect = canvas.getBoundingClientRect();
          if (rect.width === 0 || rect.height === 0) return;
          const w = Math.max(1, Math.floor(rect.width * dpr));
          const h = Math.max(1, Math.floor(rect.height * dpr));
          if (canvas.width !== w || canvas.height !== h) {
            canvas.width = w;
            canvas.height = h;
          }
        };
        const _chartResizeObservers = [];
        const observeChartCanvas = (canvas) => {
          if (!canvas || !window.ResizeObserver) return;
          const ro = new ResizeObserver((entries) => {
            for (const entry of entries) {
              const cvs = entry.target;
              const interval = cvs.getAttribute('data-interval-canvas');
              if (interval && state.charts[interval]) {
                state.charts[interval].dirty = true;
                resizeCanvasToContainer(cvs);
              }
            }
          });
          ro.observe(canvas);
          _chartResizeObservers.push(ro);
        };
        const drawCandlestickChart = (canvas, candles, hoverPrice, hoverIndex, hoverLineColor, alertPrices) => {
          try {
            return _drawCandlestickChartInner(canvas, candles, hoverPrice, hoverIndex, hoverLineColor, alertPrices);
          } catch (err) {
            console.warn('drawCandlestickChart error:', err);
            try {
              if (!canvas) return;
              const ctx = canvas.getContext('2d');
              if (!ctx) return;
              ctx.clearRect(0, 0, canvas.width, canvas.height);
              ctx.fillStyle = '#090B0F';
              ctx.fillRect(0, 0, canvas.width, canvas.height);
              ctx.fillStyle = '#475569';
              ctx.font = '12px Arial';
              ctx.textAlign = 'center';
              ctx.textBaseline = 'middle';
              ctx.fillText('Chart Error', canvas.width / 2, canvas.height / 2);
            } catch {}
          }
        };
        const _drawCandlestickChartInner = (canvas, candles, hoverPrice, hoverIndex, hoverLineColor, alertPrices) => {
          if (!canvas) return;
          const ctx = canvas.getContext('2d');
          if (!ctx) return;
          if (canvas.width < 10 || canvas.height < 10) return;
          const width = canvas.width;
          const height = canvas.height;
          const padding = Math.max(8, Math.floor(width * 0.02));
          const chartW = width - padding * 2;
          const chartH = height - padding * 2;
          const chartBg = '#1a1a1a';
          ctx.clearRect(0, 0, width, height);
          ctx.fillStyle = chartBg;
          ctx.fillRect(0, 0, width, height);
          if (!candles || candles.length === 0) {
            ctx.fillStyle = '#475569';
            ctx.font = `${Math.max(10, Math.floor(height * 0.08))}px Arial`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('No Data', width / 2, height / 2);
            return;
          }
          const prices = [];
          for (const c of candles) {
            prices.push(c.high, c.low);
          }
          let minP = Math.min(...prices);
          let maxP = Math.max(...prices);
          const range = (maxP - minP) || 1;
          const count = candles.length;
          const slot = chartW / count;
          const candleW = Math.max(1, Math.floor(slot * 0.7));
          const yFor = (p) => padding + (1 - (p - minP) / range) * chartH;
          for (let i = 0; i < count; i++) {
            const c = candles[i];
            const xCenter = padding + i * slot + slot / 2;
            const yO = yFor(c.open);
            const yC = yFor(c.close);
            const yH = yFor(c.high);
            const yL = yFor(c.low);
            const up = c.close >= c.open;
            ctx.strokeStyle = up ? '#26D4AC' : '#F23645';
            ctx.fillStyle = up ? '#26D4AC' : '#F23645';
            ctx.lineWidth = Math.max(1, Math.floor(width * 0.002));
            ctx.beginPath();
            ctx.moveTo(xCenter, yH);
            ctx.lineTo(xCenter, yL);
            ctx.stroke();
            const top = Math.min(yO, yC);
            const bodyH = Math.max(1, Math.abs(yO - yC));
            ctx.fillRect(Math.floor(xCenter - candleW / 2), Math.floor(top), candleW, Math.floor(bodyH));
          }
          if (Array.isArray(alertPrices) && alertPrices.length) {
            ctx.save();
            ctx.strokeStyle = 'rgba(255, 165, 0, 0.95)';
            ctx.lineWidth = Math.max(1, Math.floor(width * 0.002));
            ctx.setLineDash([Math.max(8, Math.floor(width * 0.02)), Math.max(6, Math.floor(width * 0.015))]);
            for (const ap of alertPrices) {
              if (!Number.isFinite(ap)) continue;
              if (ap < minP || ap > maxP) continue;
              const y = yFor(ap);
              ctx.beginPath();
              ctx.moveTo(padding, y);
              ctx.lineTo(width - padding, y);
              ctx.stroke();
            }
            ctx.restore();
          }
          if (Number.isInteger(hoverIndex) && hoverIndex >= 0 && hoverIndex < candles.length) {
            const xCenter = padding + hoverIndex * slot + slot / 2;
            ctx.save();
            ctx.strokeStyle = String(hoverLineColor || 'rgba(255, 255, 255, 0.52)').trim() ||
              'rgba(255, 255, 255, 0.52)';
            ctx.lineWidth = Math.max(1, Math.floor(width * 0.002));
            ctx.setLineDash([Math.max(6, Math.floor(width * 0.015)), Math.max(5, Math.floor(width * 0.012))]);
            ctx.beginPath();
            ctx.moveTo(xCenter, padding);
            ctx.lineTo(xCenter, height - padding);
            ctx.stroke();
            ctx.restore();
          }
          if (Number.isInteger(hoverIndex) && hoverIndex >= 0 && hoverIndex < candles.length) {
            const c = candles[hoverIndex];
            const diff = Number.isFinite(c.close) && Number.isFinite(c.open) ? (c.close - c.open) : null;
            const pct = diff !== null && Number.isFinite(c.open) && c.open !== 0 ? (diff / c.open) * 100 : null;
            if (diff !== null && Number.isFinite(pct)) {
              const fontSize = Math.max(14, Math.floor(height * 0.085));
              const padX = Math.max(8, Math.floor(fontSize * 0.5));
              const padY = Math.max(6, Math.floor(fontSize * 0.38));
              const pctText = `${diff >=0 ? '+' : ''}${pct.toFixed(2)}%`;
              const text = `Δ ${pctText}`;
              ctx.save();
              ctx.font = `${fontSize}px Segoe UI, Arial, sans-serif`;
              ctx.textAlign = 'left';
              ctx.textBaseline = 'top';
              const textW = Math.ceil(ctx.measureText(text).width);
              const rectW = textW + padX * 2;
              const rectH = fontSize + padY * 2;
              const x = padding;
              const y = padding;
              ctx.fillStyle = diff >= 0 ? 'rgba(38, 212, 172, 1)' : 'rgba(242, 54, 69, 1)';
              ctx.fillRect(x, y, rectW, rectH);
              ctx.strokeStyle = diff >= 0 ? 'rgba(38, 212, 172, 1)' : 'rgba(242, 54, 69, 1)';
              ctx.lineWidth = 1;
              ctx.strokeRect(x + 0.5, y + 0.5, rectW - 1, rectH - 1);
              ctx.fillStyle = '#FFFFFF';
              ctx.fillText(text, x + padX, y + padY);
              ctx.restore();
            }
          }
          if (Number.isFinite(hoverPrice)) {
            let y = yFor(hoverPrice);
            y = Math.max(padding, Math.min(height - padding, y));
            const fontSize = Math.max(20, Math.floor(height * 0.09));
            const label = formatPlainNumber(hoverPrice);
            const padX = Math.max(6, Math.floor(fontSize * 0.45));
            const padY = Math.max(4, Math.floor(fontSize * 0.35));
            ctx.save();
            ctx.strokeStyle = String(hoverLineColor || 'rgba(255, 255, 255, 0.52)').trim() ||
              'rgba(255, 255, 255, 0.52)';
            ctx.lineWidth = Math.max(1, Math.floor(width * 0.002));
            ctx.setLineDash([Math.max(6, Math.floor(width * 0.015)), Math.max(5, Math.floor(width * 0.012))]);
            ctx.beginPath();
            ctx.moveTo(padding, y);
            ctx.lineTo(width - padding, y);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.font = `${fontSize}px Segoe UI, Arial, sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            const textW = Math.ceil(ctx.measureText(label).width);
            const rectW = textW + padX * 2;
            const rectH = fontSize + padY * 2;
            const xCenter = width / 2;
            const halfH = rectH / 2;
            const yClamped = Math.max(padding + halfH, Math.min(height - padding - halfH, y));
            const rectX = Math.floor(xCenter - rectW / 2);
            const rectY = Math.floor(yClamped - rectH / 2);
            ctx.fillStyle = 'rgba(0, 0, 0, 0.60)';
            ctx.fillRect(rectX, rectY, rectW, rectH);
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.16)';
            ctx.strokeRect(rectX + 0.5, rectY + 0.5, rectW - 1, rectH - 1);
            ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
            ctx.fillText(label, xCenter, yClamped);
            ctx.restore();
          }
        };
        const buildCard = (symbol) => {
          const display = symbol.replace('USDT', '');
          const intervalSections = CONFIG.INTERVALS.map((i) => {
            return `
          <div class="chart-section" data-interval-section="${i}">
            <div class="chart-header">
              <div class="chart-title">${i}</div>
              <div class="chart-meta" data-interval-meta="${i}"></div>
              <span class="kline-change" data-interval-change="${i}"></span>
              <span class="kline-rsi" data-interval-rsi="${i}"></span>
              <div class="chart-countdown" data-interval-countdown="${i}"></div>
            </div>
            <div class="chart-container loading">
              <div class="chart-skeleton"><div class="chart-skeleton-bar"></div><div class="chart-skeleton-bar"></div><div class="chart-skeleton-bar"></div><div class="chart-skeleton-bar"></div></div>
              <canvas class="chart-canvas" data-interval-canvas="${i}" role="img" aria-label="${i} candlestick chart for ${display}"></canvas>
            </div>
          </div>
`;
          }).join('');
          const card = document.createElement('div');
          card.className = 'ticker-card';
          card.innerHTML = `
        <div class="card-header">
          <div class="control-buttons">
            <input type="text" id="tickerInput" class="ticker-symbol-input" placeholder="🔍︎ Search Binance Tickers (e.g., BTC)" />
          </div>
          <div class="status-text" id="statusText"><span class="live-indicator connecting"></span> Connecting...</div>
        </div>

        <div class="status-row">
          <h3>Multi Timeframes</h3>
          <div class="status-header-info">
            <div class="ticker-title" id="tickerTitle"><img src="https://bin.bnbstatic.com/static/images/common/favicon.ico" class="binance-favicon" alt="Binance" onerror="this.style.display='none'" />${display}</div>
            <div class="header-price" id="headerPrice">Loading...</div>
            <button class="copy-price-btn" id="copyPriceBtn" title="Copy current price">⧉</button>
          </div>
          <div class="timestamp" id="timestampText" style="display:none"></div>
        </div>
        <div class="chart-list">${intervalSections}</div>
        <div class="chart-share-row">
          <div class="chart-action-buttons">

            <button id="tradeBtn" class="control-btn trade-btn" title="Open Binance Futures"><img src="https://bin.bnbstatic.com/static/images/common/favicon.ico" class="binance-favicon-btn" alt="" onerror="this.style.display='none'" />Trade</button>
            <button id="searchXBtn" class="control-btn search-x-btn" title="Search on X">𝕏 Search</button>
            <button class="control-btn share-btn" id="chartShareBtn" type="button">
              <span style="margin-right:6px">𝕏</span>Share
            </button>
          </div>
        </div>

          <div class="fav-tickers-section" id="favTickersSection">
            <span class="fav-tickers-heading">★ Favourites:</span>
            <div class="fav-tickers-list" id="favTickersList">
              <span class="fav-tickers-empty">No favourites yet. Use ★ in the search dropdown to add.</span>
            </div>
          </div>

        <!-- OPEN INTEREST PRICE PANEL -->
        <div class="multioi-panel" id="oiPricePanel">
          <div class="multioi-header">
            <div class="multioi-header-left">
              <span class="multioi-title">Multi OI — Open Interest Price Indicator</span>
              <span class="multioi-tooltip-wrap">
                <span class="multioi-info-btn" title="How Multi OI works">?</span>
                <span class="multioi-tooltip-popup">
  <strong style="font-size:1.2rem">Multi OI — Open Interest Price Indicator</strong><br>
  <span style="color:var(--muted-2);font-size:1.0rem">Classifies price vs. OI across 30m, 1H, 4H using Robust Z-scores (median + MAD), ADX-gated classification, and cold start guards.</span><br><br>

  <strong style="color:var(--text)">Processing Pipeline</strong><br>
  <span style="font-size:1rem;color:var(--muted-3);font-family:monospace;line-height:1.7">
Raw Data (Price + Volume + OI Hist + Funding Hist + Current OI/FR)<br>
&nbsp;&nbsp;│<br>
  &nbsp;&nbsp;│&nbsp;&nbsp;<span style="color:var(--accent)">For EACH timeframe (30m, 1H, 4H) independently:</span><br>
&nbsp;&nbsp;│<br>
  &nbsp;&nbsp;├─► <b>HARD FILTER 1:</b> Data Readiness? (30m≥34, 1H≥34, 4H≥34 bars, all TFs ≥29 candles for ADX)<br>
&nbsp;&nbsp;│&nbsp;&nbsp;&nbsp;Fail → Neutral (insufficient data — includes specific reason: closes/OI/candles)<br>
  &nbsp;&nbsp;├─► <b>HARD FILTER 2:</b> Market Trending? (Wilder's ADX &gt; 20)<br>
&nbsp;&nbsp;│&nbsp;&nbsp;&nbsp;Fail → Neutral (ranging/choppy — classification skipped, Z-scores still shown)<br>
  &nbsp;&nbsp;├─► <b>HARD FILTER 3:</b> Both Z-scores Significant? (|Z_Price|&gt;1.5 AND |Z_OI|&gt;2.0)<br>
&nbsp;&nbsp;│&nbsp;&nbsp;&nbsp;Fail → Neutral (both must confirm)<br>
  &nbsp;&nbsp;├─► <b>CLASSIFY</b> (using Robust Z-scores):<br>
  &nbsp;&nbsp;│&nbsp;&nbsp;&nbsp;Z_Price &gt; +1.5 &amp; Z_OI &gt; +2.0 → <b style="color:#26D4AC">Strong Uptrend (+100)</b><br>
  &nbsp;&nbsp;│&nbsp;&nbsp;&nbsp;Z_Price &gt; +1.5 &amp; Z_OI &lt; -2.0 → <b style="color:#F3A052">Weak Rally (+30)</b><br>
  &nbsp;&nbsp;│&nbsp;&nbsp;&nbsp;Z_Price &lt; -1.5 &amp; Z_OI &gt; +2.0 → <b style="color:#F23645">Strong Downtrend (-100)</b><br>
  &nbsp;&nbsp;│&nbsp;&nbsp;&nbsp;Z_Price &lt; -1.5 &amp; Z_OI &lt; -2.0 → <b style="color:#A78BFA">Exhaustion (-30)</b><br>
  &nbsp;&nbsp;│&nbsp;&nbsp;&nbsp;Otherwise → <b style="color:#6B7280">Neutral (0)</b><br>
  &nbsp;&nbsp;└─► <b>COMPOSITE OUTPUT</b>:<br>
  &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Score = (30m × 0.30) + (1H × 0.40) + (4H × 0.30)<br>
  &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Score ≥ +30 → <b style="color:#26D4AC">Bullish</b> | 0→+30 → Slightly Bullish | Score = 0 → <b style="color:#6B7280">No Clear</b> | -30→0 → Slightly Bearish | ≤-30 → <b style="color:#F23645">Bearish</b></span><br><br>

  <strong style="color:var(--text)">The Five Signals</strong><br>
  <span style="font-size:1rem;color:var(--muted-3)">
  <span style="color:#26D4AC">●</span> <b style="color:#26D4AC">Strong Uptrend</b> — Price↑ + OI↑. New longs entering. Bias: <b>Long</b>.<br>
  <span style="color:#F3A052">●</span> <b style="color:#F3A052">Weak Rally</b> — Price↑ + OI↓. Short covering, fragile. Bias: <b>Careful Long</b>.<br>
  <span style="color:#F23645">●</span> <b style="color:#F23645">Strong Downtrend</b> — Price↓ + OI↑. New shorts entering. Bias: <b>Short</b>.<br>
  <span style="color:#A78BFA">●</span> <b style="color:#A78BFA">Exhaustion</b> — Price↓ + OI↓. Liquidations. Bias: <b>Watch for Reversal</b>.<br>
  <span style="color:#6B7280">●</span> <b style="color:#6B7280">Neutral</b> — No clear signal. <b>No directional bias.</b></span><br><br>

  <strong style="color:var(--text)">Timeframe Dots</strong><br>
  <span style="font-size:1rem;color:var(--muted-3)">
  <span style="color:#2E7D32">●</span> <b style="color:#2E7D32">30m</b> &nbsp;
  <span style="color:#1565C0">●</span> <b style="color:#1565C0">1H</b> &nbsp;
  <span style="color:#7B1FA2">●</span> <b style="color:#7B1FA2">4H</b> — Each dot in the quadrant grid represents one timeframe. Larger dot = longer timeframe (4H is largest).</span><br><br>

  <strong style="color:var(--text)">How to Read</strong><br>
  <span style="font-size:1rem;color:var(--muted-3);font-family:monospace;line-height:1.65">
  <b style="color:var(--text)">1.</b> Read Composite Signal first — direction + score<br>
  <b style="color:var(--text)">2.</b> Check Timeframe Agreement (4H → 1H → 30m) — all 3 agree = high conviction<br>
  <b style="color:var(--text)">3.</b> Read Signal Remark — scenario + [Stage — Action]<br>
  <b style="color:var(--text)">4.</b> Check per-TF Z-scores in the summary — values approaching thresholds = transition incoming<br>
  <b style="color:var(--text)">5.</b> Check sparklines (Score, Price) — visual context for trend direction and extremes<br>
  <b style="color:var(--text)">6.</b> Respect Neutral — no signal IS a signal<br>
  <b style="color:var(--text)">7.</b> You Decide — Scalpers weigh 30m | Swing weigh 1H | Position weigh 4H</span><br><br>

  <strong style="color:var(--text)">Signal Remark</strong><br>
  <span style="font-size:1rem;color:var(--muted-3)">
  A short annotation next to the Composite Signal that adds context beyond the raw score. Determined by: <b>(1) Multi-timeframe agreement</b> &mdash; all TFs aligned = clean confirmation; conflicting (bull+bear or bull+EX) = &ldquo;Mixed Signals&rdquo; caution; fading (SD+EX) = &ldquo;Fading Momentum&rdquo; warning; EX-dominant = &ldquo;Exhaustion Reversal&rdquo; or &ldquo;Mild Exhaustion&rdquo;. <b>(2) Funding rate context</b> &mdash; same-direction extreme funding warns of overcrowding; contrarian funding highlights squeeze fuel.</span><br>
  <span style="font-size:1rem;color:var(--muted-3)">
  <b>How to use:</b> Treat the Remark as a confidence filter. Clean remark = trust the score. Cautious remark = reduce size, widen stops, or wait for confirmation.</span><br><br>

  <strong style="color:var(--text)">Z-score Metrics</strong><br>
  <span style="font-size:1rem;color:var(--muted-3)">
  <span style="color:#5B8CFF"><b>Z_Price</b></span> — Robust Z of prices (median + MAD). Current candle excluded from baseline.<br>
  <span style="color:#F3A052"><b>Z_OI</b></span> — Robust Z of OI (median + MAD). Current candle excluded from baseline.<br>
  <b>Boundary:</b> |Z_Price| &gt; 1.5 and |Z_OI| &gt; 2.0 are strict — exactly 1.5/2.0 does NOT classify.</span><br><br>

  <strong style="color:var(--text)">Sparklines (Soft Context)</strong><br>
  <span style="font-size:1rem;color:var(--muted-3)">
  <b>Score</b> — 9 pts, 1H intervals. Rising = strengthening, falling = deteriorating.<br>
  <b>Price</b> — 1H close prices (9 pts).<br>
  <b>Z_Price</b> — 1H Robust Z-score of price (9 pts, 8 historical + 1 live).<br>
  <b>Z_OI</b> — 1H Robust Z-score of OI (9 pts, 8 historical + 1 live).</span><br><br>

  <strong style="color:var(--text)">Data Update Frequency</strong><br>
  <span style="font-size:1rem;color:var(--muted-3);font-family:monospace;line-height:1.7">
  <b style="color:#26D4AC">● Real-time (WS, ~1–3s):</b> Sparkline title values (Price)<br>
  <b style="color:#5B8CFF">● Computed (REST, 30s):</b> Composite Score, Scenarios, Z-scores, Quadrant, Sparklines<br>
  <b style="color:#F3A052">● WS-throttled (5s):</b> Signal Remark funding context<br>
  <b style="color:var(--muted-2)">● Slow (REST, 60s):</b> Funding rate REST fallback</span><br><br>

  <strong style="color:var(--warn)">Limitations</strong><br>
  <span style="font-size:1rem;color:var(--muted-3)">
  Experimental — not backtested. Use as a <b>confluence tool</b>, never standalone. Not financial advice.</span><br><br>

  <em style="color:var(--warn);font-size:1.0rem">Not financial advice. Always do your own research.</em>
</span>
              </span>
              <span class="multioi-copy-btn" id="oiCopyBtn" title="Copy Multi OI panel as image">&#x29C9;</span>
            </div>
          </div>

          <div class="multioi-content">
            <!-- Working indicator -->
            <div id="multioiWorking" class="multioi-working-indicator" style="display:flex">
              <span class="multioi-working-spinner"></span>
              <span>Working...</span>
            </div>
            <div id="oiPriceWarning" class="multioi-data-warning" style="display:none;"></div>

            <!-- Three-Column Card Layout -->
            <div class="multioi-three-card-layout">

              <!-- Card 1: Composite View -->
              <div class="multioi-card multioi-card--composite">
                <div class="multioi-card__title">Composite View</div>
                <div class="multioi-card__body">
                  <div class="multioi-composite-signal" id="multioiCompositeSignal">
                    <div class="composite-ticker-header">
                      <span class="composite-ticker-title" id="compositeTickerTitle"><img id="compositeTickerFavicon" src="" class="composite-ticker-favicon" alt="" style="display:none" /></span>
                      <span class="composite-ticker-price" id="compositeTickerPrice">Loading...</span>
                    </div>
                    <div class="composite-content-wrapper">
                      <div class="composite-direction-row">
                        <span class="composite-direction flat" id="compositeDirection">No Clear Scenario</span>
                      </div>
                      <div class="composite-score-row" id="compositeScoreRow">
                        <span class="composite-score-label">Composite Score:</span>
                        <span class="composite-score-value" id="compositeScoreValue">0</span>
                      </div>
                      <div class="composite-tf-summary" id="compositeTfSummary">
                        <div class="composite-tf-item"><span class="tf-label">30m: </span><span class="tf-scenario">Neutral </span></div>
                        <div class="composite-tf-item"><span class="tf-label">1H: </span><span class="tf-scenario">Neutral </span></div>
                        <div class="composite-tf-item"><span class="tf-label">4H: </span><span class="tf-scenario">Neutral </span></div>
                      </div>
                      <div class="multioi-signal-remark" id="multioiSignalRemark">Awaiting data...</div>
                      <div id="oiPriceDisclaimer" style="display:none;text-align:center;margin-top:4px;"><i style="font-size:0.72rem;color:var(--muted-2);opacity:0.85">Not financial advice.</i></div>
                    </div>
                  </div>
                </div>
              </div>

              <!-- Card 2: Grid View -->
              <div class="multioi-card multioi-card--grid">
                <div class="multioi-card__title">Grid View</div>
                <div class="multioi-card__body">
                  <div class="multioi-quadrant-section">
                    <!-- Top scenario labels (SU left, WR right) -->
                    <div class="quadrant-scenario-labels-row quadrant-scenario-labels-row--top">
                      <div class="quadrant-scenario-label quadrant-scenario-label--su" id="qExtLabelSU">
                        <span class="quadrant-scenario-label__name">Strong Uptrend</span>
                        <span class="quadrant-scenario-label__desc">Price ↑ + OI ↑</span>
                      </div>
                      <div class="quadrant-scenario-label quadrant-scenario-label--wr" id="qExtLabelWR">
                        <span class="quadrant-scenario-label__name">Weak Rally</span>
                        <span class="quadrant-scenario-label__desc">Price ↑ + OI ↓</span>
                      </div>
                    </div>
                    <div class="quadrant-with-axes">
                        <div class="multioi-quadrant-wrap" id="multioiQuadrantWrap">
                        <!-- Cold start progress overlay -->
                        <div class="multioi-coldstart-overlay" id="coldStartOverlay" style="display:none">
                          <div class="multioi-coldstart-overlay__title">Warming Up</div>
                          <div class="multioi-coldstart-overlay__tfs" id="coldStartTfs"></div>
                        </div>
                        <!-- Crosshair center lines -->
                        <div class="quadrant-crosshair-h">
                          <div class="quadrant-arrow-left"></div>
                          <div class="quadrant-arrow-right"></div>
                        </div>
                        <div class="quadrant-crosshair-v">
                          <div class="quadrant-arrow-up"></div>
                          <div class="quadrant-arrow-down"></div>
                        </div>

                        <!-- 4 Quadrant Cells -->
                        <!-- Row 1: SU | WR -->
                        <!-- Row 2: SD | EX -->
                        <div class="multioi-quadrant-grid">
                          <div class="quadrant-cell quadrant-cell--su" id="qCellSU"></div>
                          <div class="quadrant-cell quadrant-cell--wr" id="qCellWR"></div>
                          <div class="quadrant-cell quadrant-cell--sd" id="qCellSD"></div>
                          <div class="quadrant-cell quadrant-cell--ex" id="qCellEX"></div>
                        </div>
                          <!-- Brand Watermark -->
                          <div class="quadrant-watermark">MultiPerps.com</div>
                        </div>
                    </div>
                    <!-- Tooltip/Z-label overlay -->
                    <div class="quadrant-tooltip-layer" id="quadrantTooltipLayer"></div>

                    <!-- Bottom scenario labels (SD left, EX right) -->
                    <div class="quadrant-scenario-labels-row quadrant-scenario-labels-row--bottom">
                      <div class="quadrant-scenario-label quadrant-scenario-label--sd" id="qExtLabelSD">
                        <span class="quadrant-scenario-label__name">Strong Downtrend</span>
                        <span class="quadrant-scenario-label__desc">Price ↓ + OI ↑</span>
                      </div>
                      <div class="quadrant-scenario-label quadrant-scenario-label--ex" id="qExtLabelEX">
                        <span class="quadrant-scenario-label__name">Exhaustion</span>
                        <span class="quadrant-scenario-label__desc">Price ↓ + OI ↓</span>
                      </div>
                    </div>

                  </div>
                </div>
              </div>

              <!-- Card 3: Trend View -->
              <div class="multioi-card multioi-card--context">
                <div class="multioi-card__title">Trend View</div>
                <div class="multioi-card__body">
                  <div class="multioi-sparklines-section">
                    <div class="multioi-sparkline-card" data-sparkline="composite">
                      <div class="multioi-sparkline-card__title">1H Composite Score (Last 9) <span class="multioi-sparkline-hover-val" id="compositeHoverVal"></span><span class="multioi-sparkline-last-val" id="compositeLastVal"></span></div>
                      <canvas id="compositeSparklineCanvas"></canvas>
                    </div>
                    <div class="multioi-sparkline-card" data-sparkline="price">
                      <div class="multioi-sparkline-card__title">1H Price (Last 9) <span class="multioi-sparkline-hover-val" id="priceHoverVal"></span><span class="multioi-sparkline-last-val" id="priceLastVal"></span></div>
                      <canvas id="priceSparklineCanvas"></canvas>
                    </div>
                    <div class="multioi-sparkline-card" data-sparkline="zprice">
                      <div class="multioi-sparkline-card__title">1H Z_Price (Last 9) <span class="multioi-sparkline-hover-val" id="zPriceHoverVal"></span><span class="multioi-sparkline-last-val" id="zPriceLastVal"></span></div>
                      <canvas id="zPriceSparklineCanvas"></canvas>
                    </div>
                    <div class="multioi-sparkline-card" data-sparkline="zoi">
                      <div class="multioi-sparkline-card__title">1H Z_OI (Last 9) <span class="multioi-sparkline-hover-val" id="zOiHoverVal"></span><span class="multioi-sparkline-last-val" id="zOiLastVal"></span></div>
                      <canvas id="zOiSparklineCanvas"></canvas>
                    </div>

                  </div>
                  <div id="oiPriceContext" class="multioi-context-row" style="display:none;"></div>
                </div>
              </div>

            </div><!-- /multioi-three-card-layout -->
          </div>
        </div>



        <div class="multi-alert-panel" id="multiAlertPanel">
          <div class="multi-alert-header">
            <h3>Multi Alerts</h3>
          </div>
          <div class="multi-alert-inputs" id="multiAlertInputs">
            <!-- Alert Card 1 -->
            <div class="alert-card" id="alertSlot1">
              <div class="alert-card-header">
                <span class="alert-label">Alert 1</span>
                <span class="alert-live-status" id="alertLive1"><span class="alert-live-dot"></span>Idle</span>
                <button class="control-btn alert-remove-btn" id="removeAlert1" type="button" title="Remove alert">✕</button>
              </div>
              <div class="alert-card-body">
                <input type="text" id="alertTicker1" class="alert-price-input alert-ticker-input" placeholder="Ticker" style="width:90px;min-width:70px;" />
                <select id="alertType1" class="alert-type-select">
                  <option value="price">Price</option>
                  <option value="funding">Funding %</option>
                </select>
                <input type="number" step="any" inputmode="decimal" id="alertPrice1" class="alert-price-input alert-value-input" placeholder="Price" />
              </div>
              <div class="alert-card-center">
                <button class="control-btn alert-load-btn" id="alertLoad1" type="button" title="Load this ticker in chart">Load</button>
                <span class="rt-price-group"><span class="alert-rt-price" id="alertRtPrice1" title="Real-time value">--</span><button class="control-btn alert-copy-rt-btn" id="alertCopyRt1" type="button" title="Copy real-time value">⧉</button></span>
              </div>
              <span class="alert-slot-log" id="alertLog1"></span>
            </div>
            <!-- Alert Card 2 -->
            <div class="alert-card" id="alertSlot2">
              <div class="alert-card-header">
                <span class="alert-label">Alert 2</span>
                <span class="alert-live-status" id="alertLive2"><span class="alert-live-dot"></span>Idle</span>
                <button class="control-btn alert-remove-btn" id="removeAlert2" type="button" title="Remove alert">✕</button>
              </div>
              <div class="alert-card-body">
                <input type="text" id="alertTicker2" class="alert-price-input alert-ticker-input" placeholder="Ticker" style="width:90px;min-width:70px;" />
                <select id="alertType2" class="alert-type-select">
                  <option value="price">Price</option>
                  <option value="funding">Funding %</option>
                </select>
                <input type="number" step="any" inputmode="decimal" id="alertPrice2" class="alert-price-input alert-value-input" placeholder="Price" />
              </div>
              <div class="alert-card-center">
                <button class="control-btn alert-load-btn" id="alertLoad2" type="button" title="Load this ticker in chart">Load</button>
                <span class="rt-price-group"><span class="alert-rt-price" id="alertRtPrice2" title="Real-time value">--</span><button class="control-btn alert-copy-rt-btn" id="alertCopyRt2" type="button" title="Copy real-time value">⧉</button></span>
              </div>
              <span class="alert-slot-log" id="alertLog2"></span>
            </div>
            <!-- Alert Card 3 -->
            <div class="alert-card" id="alertSlot3">
              <div class="alert-card-header">
                <span class="alert-label">Alert 3</span>
                <span class="alert-live-status" id="alertLive3"><span class="alert-live-dot"></span>Idle</span>
                <button class="control-btn alert-remove-btn" id="removeAlert3" type="button" title="Remove alert">✕</button>
              </div>
              <div class="alert-card-body">
                <input type="text" id="alertTicker3" class="alert-price-input alert-ticker-input" placeholder="Ticker" style="width:90px;min-width:70px;" />
                <select id="alertType3" class="alert-type-select">
                  <option value="price">Price</option>
                  <option value="funding">Funding %</option>
                </select>
                <input type="number" step="any" inputmode="decimal" id="alertPrice3" class="alert-price-input alert-value-input" placeholder="Price" />
              </div>
              <div class="alert-card-center">
                <button class="control-btn alert-load-btn" id="alertLoad3" type="button" title="Load this ticker in chart">Load</button>
                <span class="rt-price-group"><span class="alert-rt-price" id="alertRtPrice3" title="Real-time value">--</span><button class="control-btn alert-copy-rt-btn" id="alertCopyRt3" type="button" title="Copy real-time value">⧉</button></span>
              </div>
              <span class="alert-slot-log" id="alertLog3"></span>
            </div>
            <!-- Alert Card 4 -->
            <div class="alert-card" id="alertSlot4">
              <div class="alert-card-header">
                <span class="alert-label">Alert 4</span>
                <span class="alert-live-status" id="alertLive4"><span class="alert-live-dot"></span>Idle</span>
                <button class="control-btn alert-remove-btn" id="removeAlert4" type="button" title="Remove alert">✕</button>
              </div>
              <div class="alert-card-body">
                <input type="text" id="alertTicker4" class="alert-price-input alert-ticker-input" placeholder="Ticker" style="width:90px;min-width:70px;" />
                <select id="alertType4" class="alert-type-select">
                  <option value="price">Price</option>
                  <option value="funding">Funding %</option>
                </select>
                <input type="number" step="any" inputmode="decimal" id="alertPrice4" class="alert-price-input alert-value-input" placeholder="Price" />
              </div>
              <div class="alert-card-center">
                <button class="control-btn alert-load-btn" id="alertLoad4" type="button" title="Load this ticker in chart">Load</button>
                <span class="rt-price-group"><span class="alert-rt-price" id="alertRtPrice4" title="Real-time value">--</span><button class="control-btn alert-copy-rt-btn" id="alertCopyRt4" type="button" title="Copy real-time value">⧉</button></span>
              </div>
              <span class="alert-slot-log" id="alertLog4"></span>
            </div>
          </div>
          <div class="multi-alert-note" style="padding:6px 10px;font-size:0.95rem;color:var(--warn);text-align:center;border-top:1px solid rgba(255,255,255,0.04);">
* Keep this site open in a browser tab to receive alerts. Alerts work even in background tabs. Notifications require a one-time permission.
          </div>
        </div>

        <div class="multi-ticker-section" id="multiTickerSection">
          <div class="multi-ticker-header">
            <h3>Multi Tickers</h3>
            <div class="tracker-timeframe-slider" id="trackerTimeframeSlider">
              <button type="button" class="tracker-tf-btn" data-tf="15m">15M</button>
              <button type="button" class="tracker-tf-btn active" data-tf="1h">1H</button>
              <button type="button" class="tracker-tf-btn" data-tf="4h">4H</button>
              <button type="button" class="tracker-tf-btn" data-tf="1d">1D</button>
              <button type="button" class="tracker-tf-btn" data-tf="1w">1W</button>
            </div>
          </div>
          <div class="multi-ticker-grid" id="multiTickerGrid">
            <!-- Tracker slots (JS) -->
          </div>
        </div>

        <!-- Rankings Section -->
        <div class="rankings-section" id="rankingsSection">
          <div class="rankings-header">
            <h2>Multi Ranks</h2>
          </div>
          <div class="rankings-grid" id="rankingsGrid">
            <div class="ranking-card" data-rank-type="gainers">
              <div class="ranking-card-header">
                <div class="ranking-card-title"><span class="dot gainers"></span> Top Gainers</div>
              </div>
              <div class="ranking-loading" id="gainersLoading">
              <table class="ranking-table">
                <thead><tr><th>#</th><th>★</th><th>Symbol</th><th>Price</th><th>24h %</th><th>🔗</th></tr></thead>
                <tbody>
                  <tr><td><span class="rank-num">1</span></td><td>☆</td><td><div class="skeleton-text" style="width:60px"></div></td><td><div class="skeleton-text" style="width:80px"></div></td><td><div class="skeleton-text" style="width:50px"></div></td><td>🔗</td></tr>
                  <tr><td><span class="rank-num">2</span></td><td>☆</td><td><div class="skeleton-text" style="width:55px"></div></td><td><div class="skeleton-text" style="width:75px"></div></td><td><div class="skeleton-text" style="width:45px"></div></td><td>🔗</td></tr>
                  <tr><td><span class="rank-num">3</span></td><td>☆</td><td><div class="skeleton-text" style="width:65px"></div></td><td><div class="skeleton-text" style="width:70px"></div></td><td><div class="skeleton-text" style="width:55px"></div></td><td>🔗</td></tr>
                  <tr><td><span class="rank-num">4</span></td><td>☆</td><td><div class="skeleton-text" style="width:50px"></div></td><td><div class="skeleton-text" style="width:85px"></div></td><td><div class="skeleton-text" style="width:40px"></div></td><td>🔗</td></tr>
                  <tr><td><span class="rank-num">5</span></td><td>☆</td><td><div class="skeleton-text" style="width:60px"></div></td><td><div class="skeleton-text" style="width:80px"></div></td><td><div class="skeleton-text" style="width:50px"></div></td><td>🔗</td></tr>
                </tbody>
              </table>
            </div>
              <div id="gainersContent"></div>
            </div>
            <div class="ranking-card" data-rank-type="losers">
              <div class="ranking-card-header">
                <div class="ranking-card-title"><span class="dot losers"></span> Top Losers</div>
              </div>
              <div class="ranking-loading" id="losersLoading">
              <table class="ranking-table">
                <thead><tr><th>#</th><th>★</th><th>Symbol</th><th>Price</th><th>24h %</th><th>🔗</th></tr></thead>
                <tbody>
                  <tr><td><span class="rank-num">1</span></td><td>☆</td><td><div class="skeleton-text" style="width:60px"></div></td><td><div class="skeleton-text" style="width:80px"></div></td><td><div class="skeleton-text" style="width:50px"></div></td><td>🔗</td></tr>
                  <tr><td><span class="rank-num">2</span></td><td>☆</td><td><div class="skeleton-text" style="width:55px"></div></td><td><div class="skeleton-text" style="width:75px"></div></td><td><div class="skeleton-text" style="width:45px"></div></td><td>🔗</td></tr>
                  <tr><td><span class="rank-num">3</span></td><td>☆</td><td><div class="skeleton-text" style="width:65px"></div></td><td><div class="skeleton-text" style="width:70px"></div></td><td><div class="skeleton-text" style="width:55px"></div></td><td>🔗</td></tr>
                  <tr><td><span class="rank-num">4</span></td><td>☆</td><td><div class="skeleton-text" style="width:50px"></div></td><td><div class="skeleton-text" style="width:85px"></div></td><td><div class="skeleton-text" style="width:40px"></div></td><td>🔗</td></tr>
                  <tr><td><span class="rank-num">5</span></td><td>☆</td><td><div class="skeleton-text" style="width:60px"></div></td><td><div class="skeleton-text" style="width:80px"></div></td><td><div class="skeleton-text" style="width:50px"></div></td><td>🔗</td></tr>
                </tbody>
              </table>
            </div>
              <div id="losersContent"></div>
            </div>
            <div class="ranking-card" data-rank-type="volume">
              <div class="ranking-card-header">
                <div class="ranking-card-title"><span class="dot volume"></span> Top Volume</div>
              </div>
              <div class="ranking-loading" id="volumeLoading">
              <table class="ranking-table">
                <thead><tr><th>#</th><th>★</th><th>Symbol</th><th>Price</th><th>Volume (24h)</th><th>🔗</th></tr></thead>
                <tbody>
                  <tr><td><span class="rank-num">1</span></td><td>☆</td><td><div class="skeleton-text" style="width:60px"></div></td><td><div class="skeleton-text" style="width:80px"></div></td><td><div class="skeleton-text" style="width:70px"></div></td><td>🔗</td></tr>
                  <tr><td><span class="rank-num">2</span></td><td>☆</td><td><div class="skeleton-text" style="width:55px"></div></td><td><div class="skeleton-text" style="width:75px"></div></td><td><div class="skeleton-text" style="width:65px"></div></td><td>🔗</td></tr>
                  <tr><td><span class="rank-num">3</span></td><td>☆</td><td><div class="skeleton-text" style="width:65px"></div></td><td><div class="skeleton-text" style="width:70px"></div></td><td><div class="skeleton-text" style="width:60px"></div></td><td>🔗</td></tr>
                  <tr><td><span class="rank-num">4</span></td><td>☆</td><td><div class="skeleton-text" style="width:50px"></div></td><td><div class="skeleton-text" style="width:85px"></div></td><td><div class="skeleton-text" style="width:75px"></div></td><td>🔗</td></tr>
                  <tr><td><span class="rank-num">5</span></td><td>☆</td><td><div class="skeleton-text" style="width:60px"></div></td><td><div class="skeleton-text" style="width:80px"></div></td><td><div class="skeleton-text" style="width:70px"></div></td><td>🔗</td></tr>
                </tbody>
              </table>
            </div>
              <div id="volumeContent"></div>
            </div>
            <div class="ranking-card" data-rank-type="oi">
              <div class="ranking-card-header">
                <div class="ranking-card-title"><span class="dot oi"></span> Top Open Interest</div>
              </div>
              <div class="ranking-loading" id="oiLoading">
              <table class="ranking-table">
                <thead><tr><th>#</th><th>★</th><th>Symbol</th><th>Price</th><th>OI (Notional)</th><th>🔗</th></tr></thead>
                <tbody>
                  <tr><td><span class="rank-num">1</span></td><td>☆</td><td><div class="skeleton-text" style="width:60px"></div></td><td><div class="skeleton-text" style="width:80px"></div></td><td><div class="skeleton-text" style="width:60px"></div></td><td>🔗</td></tr>
                  <tr><td><span class="rank-num">2</span></td><td>☆</td><td><div class="skeleton-text" style="width:55px"></div></td><td><div class="skeleton-text" style="width:75px"></div></td><td><div class="skeleton-text" style="width:55px"></div></td><td>🔗</td></tr>
                  <tr><td><span class="rank-num">3</span></td><td>☆</td><td><div class="skeleton-text" style="width:65px"></div></td><td><div class="skeleton-text" style="width:70px"></div></td><td><div class="skeleton-text" style="width:65px"></div></td><td>🔗</td></tr>
                  <tr><td><span class="rank-num">4</span></td><td>☆</td><td><div class="skeleton-text" style="width:50px"></div></td><td><div class="skeleton-text" style="width:85px"></div></td><td><div class="skeleton-text" style="width:50px"></div></td><td>🔗</td></tr>
                  <tr><td><span class="rank-num">5</span></td><td>☆</td><td><div class="skeleton-text" style="width:60px"></div></td><td><div class="skeleton-text" style="width:80px"></div></td><td><div class="skeleton-text" style="width:60px"></div></td><td>🔗</td></tr>
                </tbody>
              </table>
            </div>
              <div id="oiContent"></div>
            </div>
            <div class="ranking-card" data-rank-type="funding">
              <div class="ranking-card-header">
                <div class="ranking-card-title"><span class="dot funding-pos"></span> Top Positive Funding</div>
              </div>
              <div class="ranking-loading" id="fundingPosLoading">
              <table class="ranking-table">
                <thead><tr><th>#</th><th>★</th><th>Symbol</th><th>Price</th><th>Funding</th><th>🔗</th></tr></thead>
                <tbody>
                  <tr><td><span class="rank-num">1</span></td><td>☆</td><td><div class="skeleton-text" style="width:60px"></div></td><td><div class="skeleton-text" style="width:80px"></div></td><td><div class="skeleton-text" style="width:55px"></div></td><td>🔗</td></tr>
                  <tr><td><span class="rank-num">2</span></td><td>☆</td><td><div class="skeleton-text" style="width:55px"></div></td><td><div class="skeleton-text" style="width:75px"></div></td><td><div class="skeleton-text" style="width:50px"></div></td><td>🔗</td></tr>
                  <tr><td><span class="rank-num">3</span></td><td>☆</td><td><div class="skeleton-text" style="width:65px"></div></td><td><div class="skeleton-text" style="width:70px"></div></td><td><div class="skeleton-text" style="width:60px"></div></td><td>🔗</td></tr>
                  <tr><td><span class="rank-num">4</span></td><td>☆</td><td><div class="skeleton-text" style="width:50px"></div></td><td><div class="skeleton-text" style="width:85px"></div></td><td><div class="skeleton-text" style="width:45px"></div></td><td>🔗</td></tr>
                  <tr><td><span class="rank-num">5</span></td><td>☆</td><td><div class="skeleton-text" style="width:60px"></div></td><td><div class="skeleton-text" style="width:80px"></div></td><td><div class="skeleton-text" style="width:55px"></div></td><td>🔗</td></tr>
                </tbody>
              </table>
            </div>
              <div id="fundingPosContent"></div>
            </div>
            <div class="ranking-card" data-rank-type="funding">
              <div class="ranking-card-header">
                <div class="ranking-card-title"><span class="dot funding-neg"></span> Top Negative Funding</div>
              </div>
              <div class="ranking-loading" id="fundingNegLoading">
              <table class="ranking-table">
                <thead><tr><th>#</th><th>★</th><th>Symbol</th><th>Price</th><th>Funding</th><th>🔗</th></tr></thead>
                <tbody>
                  <tr><td><span class="rank-num">1</span></td><td>☆</td><td><div class="skeleton-text" style="width:60px"></div></td><td><div class="skeleton-text" style="width:80px"></div></td><td><div class="skeleton-text" style="width:55px"></div></td><td>🔗</td></tr>
                  <tr><td><span class="rank-num">2</span></td><td>☆</td><td><div class="skeleton-text" style="width:55px"></div></td><td><div class="skeleton-text" style="width:75px"></div></td><td><div class="skeleton-text" style="width:50px"></div></td><td>🔗</td></tr>
                  <tr><td><span class="rank-num">3</span></td><td>☆</td><td><div class="skeleton-text" style="width:65px"></div></td><td><div class="skeleton-text" style="width:70px"></div></td><td><div class="skeleton-text" style="width:60px"></div></td><td>🔗</td></tr>
                  <tr><td><span class="rank-num">4</span></td><td>☆</td><td><div class="skeleton-text" style="width:50px"></div></td><td><div class="skeleton-text" style="width:85px"></div></td><td><div class="skeleton-text" style="width:45px"></div></td><td>🔗</td></tr>
                  <tr><td><span class="rank-num">5</span></td><td>☆</td><td><div class="skeleton-text" style="width:60px"></div></td><td><div class="skeleton-text" style="width:80px"></div></td><td><div class="skeleton-text" style="width:55px"></div></td><td>🔗</td></tr>
                </tbody>
              </table>
            </div>
              <div id="fundingNegContent"></div>
            </div>
          </div>
        </div>
`;
          return card;
        };
        const updateStatus = () => {
          const el = state.elements;
          const hasError = state.wsStatus.level === 'error';
          const isConnecting = state.wsStatus.level === 'connecting';
          const color = hasError ? '#F23645' : (isConnecting ? '#F3A052' : '#26D4AC');
          let indicatorClass = 'live-indicator';
          if (isConnecting) indicatorClass += ' connecting';
          else if (hasError) indicatorClass += ' error';
          el.statusText.innerHTML =
            `<span class="${indicatorClass}"><\/span>${state.wsStatus.text}${state.reconnectAttempts ? ` | Reconnects: ${state.reconnectAttempts}/${WS_MAX_RECONNECT_ATTEMPTS}` : ''}`;
          el.statusText.style.color = color;
          renderAlertLiveStatus();
        };
        const updatePriceUI = () => {
          state.elements.timestampText.textContent = state.lastTradeTime ? new Date(state.lastTradeTime)
            .toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit',
              hour12: true
            }) : '';
          if (state.elements.headerPrice) {
            const oldPrice = parseFloat(state.elements.headerPrice.getAttribute('data-price')) || 0;
            const newPrice = state.currentPrice;
            state.elements.headerPrice.textContent = formatPrice(newPrice);
            state.elements.headerPrice.setAttribute('data-price', newPrice);
            if (oldPrice && newPrice) {
              state.elements.headerPrice.classList.remove('price-up', 'price-down');
              void state.elements.headerPrice.offsetWidth;
              if (newPrice > oldPrice) {
                state.elements.headerPrice.classList.add('price-up');
              } else if (newPrice < oldPrice) {
                state.elements.headerPrice.classList.add('price-down');
              }
            }
          }
          if (state.elements.compositeTickerPrice && state.elements.headerPrice) {
            state.elements.compositeTickerPrice.textContent = state.elements.headerPrice.textContent;
            state.elements.compositeTickerPrice.className = 'composite-ticker-price';
            if (state.elements.headerPrice.classList.contains('price-up')) {
              state.elements.compositeTickerPrice.classList.add('price-up');
            } else if (state.elements.headerPrice.classList.contains('price-down')) {
              state.elements.compositeTickerPrice.classList.add('price-down');
            }
          }
          const display = state.symbol.replace('USDT', '');
          document.title = Number.isFinite(state.currentPrice) ?
            `${formatPrice(state.currentPrice)} ${display} — MultiPerps | Binance Futures Chart` :
            `${display} Binance Futures Chart — Multi-Timeframe & Open Interest Price Analysis | MultiPerps`;
          for (const interval of CONFIG.INTERVALS) {
            const chart = state.charts[interval];
            if (chart && chart.meta && state.currentPrice) {
              chart.meta.textContent = `${state.symbol.replace('USDT', '')} ${formatPrice(state.currentPrice)}`;
            }
          }
        };
        const initChartsState = () => {
          state.charts = {};
          for (const interval of CONFIG.INTERVALS) {
            const canvas = state.elements.card.querySelector(`[data-interval-canvas="${interval}"]`);
            const meta = state.elements.card.querySelector(`[data-interval-meta="${interval}"]`);
            const countdownEl = state.elements.card.querySelector(`[data-interval-countdown="${interval}"]`);
            const changeEl = state.elements.card.querySelector(`[data-interval-change="${interval}"]`);
            if (canvas) {
              resizeCanvasToContainer(canvas);
              observeChartCanvas(canvas);
              canvas.addEventListener('mousemove', (e) => {
                const chart = state.charts[interval];
                if (!chart) return;
                const price = getPriceAtCanvasY(canvas, chart.candles || [], e.clientY);
                const next = Number.isFinite(price) ? price : null;
                const idx = getCandleIndexAtCanvasX(canvas, chart.candles || [], e.clientX);
                if (chart.hoverPrice === next && chart.hoverIndex === idx) return;
                chart.hoverPrice = next;
                chart.hoverIndex = idx;
                chart.hoverDirty = true;
                if (!chart._hoverRaf) {
                  chart._hoverRaf = requestAnimationFrame(() => {
                    chart._hoverRaf = null;
                    redrawChart(interval);
                  });
                }
              });
              canvas.addEventListener('mouseleave', () => {
                const chart = state.charts[interval];
                if (!chart) return;
                if (chart._hoverRaf) {
                  cancelAnimationFrame(chart._hoverRaf);
                  chart._hoverRaf = null;
                }
                if (chart.hoverPrice === null && chart.hoverIndex === null) return;
                chart.hoverPrice = null;
                chart.hoverIndex = null;
                chart.hoverDirty = true;
                redrawChart(interval);
              });
              canvas.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const price = getPriceAtCanvasY(canvas, state.charts[interval]?.candles || [], e.clientY);
                if (!Number.isFinite(price)) return;
                const title = `${toDisplayTicker(state.symbol)} ${interval} level`;
                showChartContextMenu(e.clientX, e.clientY, title, price);
              });
              {
                let _lpTimer = null;
                let _lpX = 0,
                  _lpY = 0;
                canvas.addEventListener('touchstart', (e) => {
                  const t = e.touches[0];
                  _lpX = t.clientX;
                  _lpY = t.clientY;
                  _lpTimer = setTimeout(() => {
                    const p = getPriceAtCanvasY(canvas, state.charts[interval]?.candles || [], _lpY);
                    if (!Number.isFinite(p)) return;
                    const t2 = `${toDisplayTicker(state.symbol)} ${interval} level`;
                    showChartContextMenu(_lpX, _lpY, t2, p);
                    _lpTimer = null;
                  }, 500);
                }, {
                  passive: true
                });
                canvas.addEventListener('touchmove', () => {
                  if (_lpTimer) {
                    clearTimeout(_lpTimer);
                    _lpTimer = null;
                  }
                }, {
                  passive: true
                });
                canvas.addEventListener('touchend', () => {
                  if (_lpTimer) {
                    clearTimeout(_lpTimer);
                    _lpTimer = null;
                  }
                }, {
                  passive: true
                });
                canvas.addEventListener('touchcancel', () => {
                  if (_lpTimer) {
                    clearTimeout(_lpTimer);
                    _lpTimer = null;
                  }
                }, {
                  passive: true
                });
              }
            }
            state.charts[interval] = {
              interval,
              canvas,
              meta,
              countdownEl,
              changeEl,
              rsiEl: state.elements.card.querySelector(`[data-interval-rsi="${interval}"]`),
              candles: [],
              dirty: true,
              hoverPrice: null,
              hoverIndex: null,
              hoverDirty: false,
              hoverLineColor: meta ? getComputedStyle(meta).color : 'rgba(255, 255, 255, 0.52)',
              lastUpdate: null,
            };
          }
        };
        const intervalMs = (interval) => {
          if (interval === '1m') return 60 * 1000;
          if (interval === '5m') return 5 * 60 * 1000;
          if (interval === '15m') return 15 * 60 * 1000;
          if (interval === '30m') return 30 * 60 * 1000;
          if (interval === '1h') return 60 * 60 * 1000;
          if (interval === '4h') return 4 * 60 * 60 * 1000;
          if (interval === '1d') return 24 * 60 * 60 * 1000;
          if (interval === '1w') return 7 * 24 * 60 * 60 * 1000;
          if (interval === '1M') return 30 * 24 * 60 * 60 * 1000;
          return 60 * 1000;
        };
        const formatCountdown = (msLeft) => {
          const totalSec = Math.max(0, Math.floor(msLeft / 1000));
          const h = Math.floor(totalSec / 3600);
          const m = Math.floor((totalSec % 3600) / 60);
          const s = totalSec % 60;
          if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
          return `${m}:${String(s).padStart(2, '0')}`;
        };
        const msUntilNextCandleClose = (interval, nowMs) => {
          if (interval === '1M') {
            const now = new Date(nowMs);
            const y = now.getUTCFullYear();
            const m = now.getUTCMonth();
            const nextMonthUtc = Date.UTC(y, m + 1, 1, 0, 0, 0);
            return Math.max(0, nextMonthUtc - nowMs);
          }
          if (interval === '1w') {
            const now = new Date(nowMs);
            const startOfDayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
            const day = now.getUTCDay();
            const daysSinceMonday = (day + 6) % 7;
            const startOfWeekUtc = startOfDayUtc - daysSinceMonday * 24 * 60 * 60 * 1000;
            const nextWeekUtc = startOfWeekUtc + 7 * 24 * 60 * 60 * 1000;
            return Math.max(0, nextWeekUtc - nowMs);
          }
          const ms = intervalMs(interval);
          const next = (Math.floor(nowMs / ms) + 1) * ms;
          return Math.max(0, next - nowMs);
        };
        const updateCountdowns = () => {
          const now = Date.now();
          for (const interval of CONFIG.INTERVALS) {
            const chart = state.charts[interval];
            if (!chart || !chart.countdownEl) continue;
            const left = msUntilNextCandleClose(interval, now);
            chart.countdownEl.textContent = formatCountdown(left);
          }
        };
        const removeChartSkeletons = () => {
          document.querySelectorAll('.chart-container.loading').forEach(el => {
            el.classList.remove('loading');
            const skeleton = el.querySelector('.chart-skeleton');
            if (skeleton) skeleton.remove();
          });
        };
        const redrawChart = (interval) => {
          const chart = state.charts[interval];
          if (!chart || !chart.canvas) return;
          if (chart.canvas.width < 10 || chart.canvas.height < 10) return;
          if (chart.dirty || chart.hoverDirty) {
            const alertPrices = getAlertPrices();
            drawCandlestickChart(chart.canvas, chart.candles, chart.hoverPrice, chart.hoverIndex, chart
              .hoverLineColor, alertPrices);
            chart.dirty = false;
            chart.hoverDirty = false;
          }
        };
        let _chartRafId = null;
        const scheduleChartRender = () => {
          if (_chartRafId) return;
          _chartRafId = requestAnimationFrame(() => {
            _chartRafId = null;
            if (document.hidden) return;
            const dashboardPage = document.getElementById('page-dashboard');
            if (dashboardPage && !dashboardPage.classList.contains('active')) return;
            updateChartMetas();
            redrawCharts();
            for (const interval of CONFIG.INTERVALS) {
              const chart = state.charts[interval];
              if (chart && chart.dirty) {
                scheduleChartRender();
                break;
              }
            }
          });
        };
        const markChartDirty = () => {
          for (const interval of CONFIG.INTERVALS) {
            const chart = state.charts[interval];
            if (chart) chart.dirty = true;
          }
          scheduleChartRender();
        };
        const redrawCharts = () => {
          for (const interval of CONFIG.INTERVALS) {
            const chart = state.charts[interval];
            if (chart && chart.canvas) {
              if (chart.canvas.width < 10 || chart.canvas.height < 10) continue;
            }
            redrawChart(interval);
          }
        };
        const updateChartMetas = () => {
          for (const interval of CONFIG.INTERVALS) {
            const chart = state.charts[interval];
            if (!chart) continue;
            if (!chart.dirty) continue;
            const count = chart.candles?.length || 0;
            chart.meta.textContent = count ?
              `${state.symbol.replace('USDT', '')} ${formatPrice(state.currentPrice)}` : '';

            if (chart.changeEl) {
              const last = chart.candles[count - 1];
              if (last && Number.isFinite(last.open) && Number.isFinite(last.close) && last.open !== 0) {
                const diff = last.close - last.open;
                const pct = (diff / last.open) * 100;
                const sign = diff > 0 ? '+' : '';
                const volUsdt = Number.isFinite(last.volume) ? last.volume : null;
                const volText = Number.isFinite(volUsdt) ? `, ${formatUsdtVolume(volUsdt)}` : '';
                chart.changeEl.textContent = `${sign}${pct.toFixed(2)}%${volText}`;
                chart.changeEl.classList.remove('up', 'down');
                if (diff > 0) chart.changeEl.classList.add('up');
                else if (diff < 0) chart.changeEl.classList.add('down');
              } else {
                chart.changeEl.textContent = '';
                chart.changeEl.classList.remove('up', 'down');
              }
            }

            // RSI calculation and display
            if (chart.rsiEl && count >= 15) {
              const rsi = calcRSI(chart.candles);
              if (Number.isFinite(rsi)) {
                chart.rsiEl.textContent = formatRsi(rsi);
                chart.rsiEl.className = 'kline-rsi ' + getRsiClass(rsi);
              } else {
                chart.rsiEl.textContent = '';
                chart.rsiEl.className = 'kline-rsi';
              }
            } else if (chart.rsiEl) {
              chart.rsiEl.textContent = '';
              chart.rsiEl.className = 'kline-rsi';
            }
          }
        };
//WEBSOCKET MANAGEMENT
        const closeWs = () => {
          clearReconnectTimer();
          if (state.ws) {
            try {
              state.ws.onopen = null;
              state.ws.onclose = null;
              state.ws.onerror = null;
              state.ws.onmessage = null;
            } catch {}
            try {
              state.ws.close();
            } catch {}
            state.ws = null;
          }
          closeSecondaryWs();
        };
        const closeSecondaryWs = () => {
          if (state.secondaryReconnectTimer) {
            clearTimeout(state.secondaryReconnectTimer);
            state.secondaryReconnectTimer = null;
          }
          if (state.secondaryWs) {
            try {
              state.secondaryWs.onopen = null;
              state.secondaryWs.onclose = null;
              state.secondaryWs.onerror = null;
              state.secondaryWs.onmessage = null;
            } catch {}
            try {
              state.secondaryWs.close();
            } catch {}
            state.secondaryWs = null;
          }
        };
        const connectBinanceFutures = () => {
          closeWs();
          state.wsStatus = {
            text: ` Connecting...`,
            level: 'Connecting'
          };
          updateStatus();
          const generation = (state.wsGeneration += 1);
          const mainSym = state.symbol.toLowerCase();
          const mainSymUpper = state.symbol.toUpperCase();
          const alertSymbols = [...new Set((state.multiAlerts || []).filter(a => a && a.ticker && (Number.isFinite(a
            .threshold) || Number.isFinite(a.price))).map(a => normalizeSymbol(a.ticker)).filter(s => s && s !==
            mainSymUpper))];
          const trackerSymbols = stateTracker.symbols.filter(Boolean);
          const trackerInterval = stateTracker.interval;
          const streamSet = new Set();
          streamSet.add(`${mainSym}@miniTicker`);
          streamSet.add(`${mainSym}@openInterest`);
          for (const i of CONFIG.INTERVALS) {
            streamSet.add(`${mainSym}@kline_${i}`);
          }
          for (const sym of alertSymbols) {
            streamSet.add(`${sym.toLowerCase()}@miniTicker`);
          }
          for (const sym of trackerSymbols) {
            const s = sym.toLowerCase();
            streamSet.add(`${s}@miniTicker`);
            streamSet.add(`${s}@kline_${trackerInterval}`);
          }
          const streams = [...streamSet];
          const MAX_STREAMS_PER_WS = 800;
          const estimatedUrlLen = `wss://fstream.binance.com/market/stream?streams=${streams.join('/')}`.length;
          const primaryStreams = [];
          const secondaryStreams = [];
          if (streams.length > MAX_STREAMS_PER_WS || estimatedUrlLen > 4000) {
            for (const s of streams) {
              if (s.startsWith(mainSym + '@') || s === `${mainSym}@miniTicker` || s === `${mainSym}@openInterest`) {
                primaryStreams.push(s);
              } else {
                secondaryStreams.push(s);
              }
            }
          } else {
            primaryStreams.push(...streams);
          }
          const alertSymbolSet = new Set(alertSymbols.map(s => s.toUpperCase()));
          const trackerSymbolSet = new Set(trackerSymbols.map(s => s.toUpperCase()));
          const url = `wss://fstream.binance.com/market/stream?streams=${primaryStreams.join('/')}`;
          try {
            const ws = new WebSocket(url);
            state.ws = ws;
            ws.onopen = () => {
              if (generation !== state.wsGeneration) {
                try {
                  ws.close();
                } catch {}
                return;
              }
              state.wsStatus = {
                text: 'Active',
                level: 'ok'
              };
              state.reconnectAttempts = 0;
              state.lastMessageTime = Date.now();
              _binanceErrorState.wsConsecutiveFails = 0;
              updateStatus();
              if (state.lastTradeTime !== null && !state._skipReconnectKlineRefresh) {
                Promise.all(CONFIG.INTERVALS.map(async (interval) => {
                  const chart = state.charts[interval];
                  if (!chart) return;
                  try {
                    chart.candles = await fetchExchangeKlines(state.symbol, interval, CONFIG.KLINE_LIMIT);
                  } catch {}
                  chart.dirty = true;
                })).then(() => {
                  updateChartMetas();
                  redrawCharts();
                }).catch(() => {});
              }
              state._skipReconnectKlineRefresh = false;
              if (stateTracker._wasConnected) {
                setTimeout(() => fetchTrackerKlines().catch(() => {}), 2000);
              }
              stateTracker._wasConnected = true;
              state.alertWsData = {};
            };
            ws.onclose = () => {
              if (generation !== state.wsGeneration) return;
              state.wsStatus = {
                text: 'Disconnected',
                level: 'error'
              };
              updateStatus();
              _binanceErrorState.wsConsecutiveFails++;
              if (_binanceErrorState.wsConsecutiveFails >= 3) {
                showBinanceWarning('WebSocket Connection Issues',
                  'Encountering network issues or Binance\'s IP limit.', 'Down');
                showBinanceWarningBar('⚡ Please check internet connection or remport us.',
                  'https://x.com/MultiPerps', 'Report on X @MultiPerps');
              }
              if (navigator.onLine === false) return;
              clearReconnectTimer();
              state.reconnectTimer = setTimeout(() => {
                state.reconnectTimer = null;
                if (navigator.onLine === false) return;
                state.reconnectAttempts += 1;
                if (state.reconnectAttempts > WS_MAX_RECONNECT_ATTEMPTS) {
                  state.wsStatus = {
                    text: 'Connection Lost',
                    level: 'error'
                  };
                  updateStatus();
                  showBinanceWarningBar('🔌 Connection lost after ' + WS_MAX_RECONNECT_ATTEMPTS +
                    ' attempts. Binance may be blocking your IP or your network is down.',
                    'https://x.com/MultiPerps', 'Report on X @MultiPerps');
                  const warnBar = document.getElementById('binanceWarningBar');
                  if (warnBar) {
                    const refreshLink = document.createElement('a');
                    refreshLink.href = 'javascript:location.reload()';
                    refreshLink.textContent = 'Refresh page';
                    refreshLink.style.cssText = 'color:#26D4AC;font-weight:700;';
                    warnBar.insertBefore(refreshLink, warnBar.lastChild);
                  }
                  return;
                }
                const delay = calcReconnectDelayMs(state.reconnectAttempts);
                state.reconnectTimer = setTimeout(() => connectBinanceFutures(), delay);
              }, 500);
            };
            ws.onerror = () => {
              if (generation !== state.wsGeneration) return;
              state.wsStatus = {
                text: 'Connection error',
                level: 'error'
              };
              updateStatus();
            };
            ws.onmessage = (event) => {
              if (generation !== state.wsGeneration) return;
              state.lastMessageTime = Date.now();
              state.msgsInWindow += 1;
              _binanceErrorState.wsConsecutiveFails = 0;
              if (_binanceErrorState.warningBarVisible && !_binanceErrorState.http418Time && !_binanceErrorState
                .http451Time) {
                hideBinanceWarningBar();
              }
              try {
                const msg = JSON.parse(event.data);
                const stream = msg.stream;
                const data = msg.data;
                if (!stream || !data) return;
                const sym = stream.split('@')[0].toUpperCase();
                if (stream.endsWith('@miniTicker')) {
                  const price = parseFloat(data.c);
                  const pct24h = parseFloat(data.P);
                  const vol24h = parseFloat(data.q);
                  if (Number.isFinite(price)) {
                    if (sym === mainSymUpper) {
                      state.currentPrice = price;
                      state.lastTradeTime = Date.now();
                      updatePriceUI();
                      renderAlertRtPrices();
                      updateChartMetas();
                    }
                    if (alertSymbolSet.has(sym)) {
                      state.alertWsData[sym] = {
                        price,
                        lastUpdate: Date.now()
                      };
                      if (sym !== mainSymUpper) renderAlertRtPrices();
                    }
                    if (trackerSymbolSet.has(sym)) {
                      if (!stateTracker.data[sym]) stateTracker.data[sym] = {};
                      stateTracker.data[sym].price = price;
                      if (Number.isFinite(pct24h)) stateTracker.data[sym].pct24h = pct24h;
                      if (Number.isFinite(vol24h)) stateTracker.data[sym].vol24h = vol24h;
                    }
                  }
                  return;
                }
                if (stream.endsWith('@openInterest')) {
                  if (data.e === 'openInterest' && sym === mainSymUpper) {
                    const oi = parseFloat(data.o);
                    if (Number.isFinite(oi) && oiPricePanel.symbol === mainSymUpper) {
                      if (oiPricePanel.stats.oiCurrent !== oi) {
                        oiPricePanel.stats.oiCurrent = oi;
                      }
                    }
                  }
                  return;
                }
                const k = data.k;
                if (!k || typeof k.i !== 'string') return;
                const interval = k.i;
                if (sym === mainSymUpper) {
                  const chart = state.charts[interval];
                  if (chart) {
                    const openTime = k.t;
                    const candle = {
                      openTime,
                      open: parseFloat(k.o),
                      high: parseFloat(k.h),
                      low: parseFloat(k.l),
                      close: parseFloat(k.c),
                      volume: parseFloat(k.v),
                      quoteVolume: parseFloat(k.q),
                      closeTime: k.T,
                    };
                    const last = chart.candles[chart.candles.length - 1];
                    if (!last || last.openTime < openTime) {
                      chart.candles.push(candle);
                      if (chart.candles.length > CONFIG.KLINE_LIMIT) chart.candles.shift();
                    } else if (last.openTime === openTime) {
                      chart.candles[chart.candles.length - 1] = candle;
                    }
                    chart.dirty = true;
                    chart.lastUpdate = Date.now();
                  }
                  if (interval === '1h' && oiPricePanel.symbol === mainSymUpper) {
                    // Update 1H sparkline data in real-time
                    const d = oiPricePanel.tfData['1H'];
                    if (d) {
                      const closePrice = parseFloat(k.c);
                      const qv = parseFloat(k.q);
                      const vol = parseFloat(k.v);
                      const highPrice = parseFloat(k.h);
                      const lowPrice = parseFloat(k.l);
                      const wsOpenTime = k.t;
                      // Determine if this WS message is a new candle or updating the current one
                      // d.klineTimestamps stores close times (k[6]) from the initial fetch
                      // We compare the WS openTime with the last stored kline's closeTime to detect new candles
                      const lastKlineCloseTime = d.klineTimestamps.length > 0 ? d.klineTimestamps[d.klineTimestamps.length - 1] : 0;
                      const isNewCandle = wsOpenTime > lastKlineCloseTime;
                      if (isNewCandle) {
                        // A new 1H candle has started — push new entries
                        if (Number.isFinite(closePrice)) d.closes.push(closePrice);
                        if (Number.isFinite(vol)) d.volumes.push(vol);
                        if (Number.isFinite(qv)) d.quoteVolumes.push(qv);
                        if (Number.isFinite(highPrice) && Number.isFinite(lowPrice) && Number.isFinite(closePrice)) {
                          d.candles.push({ high: highPrice, low: lowPrice, close: closePrice });
                        }
                        if (Number.isFinite(k.T)) d.klineTimestamps.push(k.T);
                        // Trim to maxKeep to prevent unbounded growth
                        const maxKeep = MF_LOOKBACK_BARS + (MF_SPARKLINE_POINTS - 1);
                        if (d.closes.length > maxKeep) d.closes = d.closes.slice(-maxKeep);
                        if (d.volumes.length > maxKeep) d.volumes = d.volumes.slice(-maxKeep);
                        if (d.quoteVolumes.length > maxKeep) d.quoteVolumes = d.quoteVolumes.slice(-maxKeep);
                        if (d.candles.length > maxKeep) d.candles = d.candles.slice(-maxKeep);
                        if (d.klineTimestamps.length > maxKeep) d.klineTimestamps = d.klineTimestamps.slice(-maxKeep);
                      } else {
                        // Same candle still forming — update the last entry
                        if (Number.isFinite(closePrice) && d.closes.length > 0) {
                          d.closes[d.closes.length - 1] = closePrice;
                        }
                        if (Number.isFinite(qv) && d.quoteVolumes.length > 0) {
                          d.quoteVolumes[d.quoteVolumes.length - 1] = qv;
                        }
                        if (Number.isFinite(vol) && d.volumes.length > 0) {
                          d.volumes[d.volumes.length - 1] = vol;
                        }
                        // Update last candle's high/low/close for accurate ADX
                        if (d.candles.length > 0) {
                          const lastCandle = d.candles[d.candles.length - 1];
                          if (Number.isFinite(highPrice)) lastCandle.high = Math.max(lastCandle.high || 0, highPrice);
                          if (Number.isFinite(lowPrice)) lastCandle.low = Math.min(lastCandle.low || Infinity, lowPrice);
                          if (Number.isFinite(closePrice)) lastCandle.close = closePrice;
                        }
                      }
                      // Update title values immediately (lightweight DOM text updates)
                      if (Number.isFinite(closePrice)) {
                        const priceEl = document.getElementById('priceLastVal');
                        if (priceEl) priceEl.textContent = '$' + closePrice.toLocaleString('en-US', {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 8
                        });
                      }
                    }
                    // Throttle sparkline canvas re-renders from WS (max once per 2s)
                    if (!oiPricePanel._wsSparklineTimer) {
                      oiPricePanel._wsSparklineTimer = setTimeout(() => {
                        // Skip if tfData hasn't been populated yet (e.g. after ticker switch,
                        // fetchData hasn't completed — avoid rendering with empty/old data).
                        if (!oiPricePanel.tfData['1H'] || !oiPricePanel.tfData['1H'].closes || oiPricePanel.tfData['1H'].closes.length === 0) {
                          oiPricePanel._wsSparklineTimer = null;
                          return;
                        }
                        // Recompute classification with the latest 1H WS data so the
                        // composite sparkline's live point stays current. Without this,
                        // the composite sparkline only updates on full REST refresh cycles
                        // (every ~60s), causing the card score and sparkline to diverge.
                        if (oiPricePanel.classification) {
                          oiPricePanel.computeClassification();
                          // Re-append the fresh live score to the cached backfill history
                          const cached = oiPricePanel._backfillCache || [];
                          const history = [...cached];
                          if (Number.isFinite(oiPricePanel.classification.signalStrength)) {
                            history.push(oiPricePanel.classification.signalStrength);
                          }
                          if (history.length > 0) {
                            oiPricePanel._scoreHistory = history.slice(-MF_SPARKLINE_POINTS);
                          }
                          // Also update Z_Price/Z_OI 1H live values
                          const cachedZP = oiPricePanel._backfillZPriceCache || [];
                          const cachedZO = oiPricePanel._backfillZOiCache || [];
                          const zpHist = [...cachedZP];
                          const zoHist = [...cachedZO];
                          const liveZP = oiPricePanel.stats.zPrice['1H'];
                          const liveZO = oiPricePanel.stats.zOi['1H'];
                          if (Number.isFinite(liveZP)) zpHist.push(liveZP);
                          if (Number.isFinite(liveZO)) zoHist.push(liveZO);
                          if (zpHist.length > 0) oiPricePanel._zPrice1hHistory = zpHist.slice(-MF_SPARKLINE_POINTS);
                          if (zoHist.length > 0) oiPricePanel._zOi1hHistory = zoHist.slice(-MF_SPARKLINE_POINTS);
                        }
                        oiPricePanel.renderCompositeSparkline();
                        oiPricePanel.renderPriceSparkline();
                        oiPricePanel.renderZPriceSparkline();
                        oiPricePanel.renderOiSparkline();
                        oiPricePanel.renderContextRow();
                        oiPricePanel._wsSparklineTimer = null;
                      }, 2000);
                    }
                  }
                }
                if (trackerSymbolSet.has(sym) && interval === trackerInterval) {
                  const candle = {
                    openTime: k.t,
                    open: parseFloat(k.o),
                    high: parseFloat(k.h),
                    low: parseFloat(k.l),
                    close: parseFloat(k.c),
                    volume: parseFloat(k.v),
                    quoteVolume: parseFloat(k.q),
                    closeTime: k.T,
                  };
                  const idx = stateTracker.symbols.indexOf(sym);
                  if (idx >= 0 && stateTracker.cards[idx]) {
                    const card = stateTracker.cards[idx];
                    const last = card.candles[card.candles.length - 1];
                    if (!last || last.openTime < candle.openTime) {
                      card.candles.push(candle);
                      if (card.candles.length > CONFIG.KLINE_LIMIT) card.candles.shift();
                    } else if (last.openTime === candle.openTime) {
                      card.candles[card.candles.length - 1] = candle;
                    }
                    card.dirty = true;
                  }
                }
              } catch (e) {
                console.warn('WS parse error:', e);
                state.wsStatus = {
                  text: 'Parse error',
                  level: 'error'
                };
                updateStatus();
              }
            };
          } catch (err) {
            state.wsStatus = {
              text: 'WS failed',
              level: 'error'
            };
            updateStatus();
            if (navigator.onLine === false) return;
            state.reconnectAttempts += 1;
            clearReconnectTimer();
            const delay = calcReconnectDelayMs(state.reconnectAttempts);
            state.reconnectTimer = setTimeout(() => connectBinanceFutures(), delay);
          }
          if (secondaryStreams.length > 0) {
            closeSecondaryWs();
            const secGeneration = (state.secondaryWsGeneration += 1);
            const secUrl = `wss://fstream.binance.com/market/stream?streams=${secondaryStreams.join('/')}`;
            try {
              const secWs = new WebSocket(secUrl);
              state.secondaryWs = secWs;
              secWs.onopen = () => {
                if (secGeneration !== state.secondaryWsGeneration) {
                  try {
                    secWs.close();
                  } catch {}
                  return;
                }
                state.secondaryReconnectAttempts = 0;
              };
              secWs.onclose = () => {
                if (secGeneration !== state.secondaryWsGeneration) return;
                if (navigator.onLine === false) return;
                if (state.secondaryReconnectTimer) {
                  clearTimeout(state.secondaryReconnectTimer);
                  state.secondaryReconnectTimer = null;
                }
                state.secondaryReconnectTimer = setTimeout(() => {
                  state.secondaryReconnectTimer = null;
                  if (navigator.onLine === false) return;
                  state.secondaryReconnectAttempts += 1;
                  if (state.secondaryReconnectAttempts > WS_MAX_RECONNECT_ATTEMPTS) return;
                  const delay = calcReconnectDelayMs(state.secondaryReconnectAttempts);
                  state.secondaryReconnectTimer = setTimeout(() => connectBinanceFutures(), delay);
                }, 500);
              };
              secWs.onerror = () => {
                if (secGeneration !== state.secondaryWsGeneration) return;
              };
              secWs.onmessage = (event) => {
                if (secGeneration !== state.secondaryWsGeneration) return;
                state.lastMessageTime = Date.now();
                try {
                  const msg = JSON.parse(event.data);
                  const stream = msg.stream;
                  const data = msg.data;
                  if (!stream || !data) return;
                  const sym = stream.split('@')[0].toUpperCase();
                  if (stream.endsWith('@miniTicker')) {
                    const price = parseFloat(data.c);
                    const pct24h = parseFloat(data.P);
                    const vol24h = parseFloat(data.q);
                    if (Number.isFinite(price)) {
                      if (alertSymbolSet.has(sym)) {
                        state.alertWsData[sym] = {
                          price,
                          lastUpdate: Date.now()
                        };
                        if (sym !== mainSymUpper) renderAlertRtPrices();
                      }
                      if (trackerSymbolSet.has(sym)) {
                        if (!stateTracker.data[sym]) stateTracker.data[sym] = {};
                        stateTracker.data[sym].price = price;
                        if (Number.isFinite(pct24h)) stateTracker.data[sym].pct24h = pct24h;
                        if (Number.isFinite(vol24h)) stateTracker.data[sym].vol24h = vol24h;
                      }
                    }
                    return;
                  }
                  const k = data.k;
                  if (!k || typeof k.i !== 'string') return;
                  const interval = k.i;
                  if (trackerSymbolSet.has(sym) && interval === trackerInterval) {
                    const candle = {
                      openTime: k.t,
                      open: parseFloat(k.o),
                      high: parseFloat(k.h),
                      low: parseFloat(k.l),
                      close: parseFloat(k.c),
                      volume: parseFloat(k.v),
                      quoteVolume: parseFloat(k.q),
                      closeTime: k.T,
                    };
                    const idx = stateTracker.symbols.indexOf(sym);
                    if (idx >= 0 && stateTracker.cards[idx]) {
                      const card = stateTracker.cards[idx];
                      const last = card.candles[card.candles.length - 1];
                      if (!last || last.openTime < candle.openTime) {
                        card.candles.push(candle);
                        if (card.candles.length > CONFIG.KLINE_LIMIT) card.candles.shift();
                      } else if (last.openTime === candle.openTime) {
                        card.candles[card.candles.length - 1] = candle;
                      }
                      card.dirty = true;
                    }
                  }
                } catch {}
              };
            } catch {
              console.warn('Secondary WebSocket creation failed — alerts/trackers using REST fallback');
            }
          } else {
            closeSecondaryWs();
          }
        };
        const reconnectPrimaryWs = () => {
          connectBinanceFutures();
        };
        const start = async () => {
          if (state.chartTimer) {
            clearInterval(state.chartTimer);
            state.chartTimer = null;
          }
          if (state.healthTimer) {
            clearInterval(state.healthTimer);
            state.healthTimer = null;
          }
          state.isRunning = true;
          state.reconnectAttempts = 0;
          state.lastMessageTime = null;
          state.lastTradeTime = null;
          state.msgsInWindow = 0;
          if (!state.urlSymbolMode) saveStored(STORAGE.symbol, state.symbol);
          await fetchCurrentPrice(state.symbol);
          const priorityIntervals = ['5m', '15m', '1h'];
          const otherIntervals = CONFIG.INTERVALS.filter(i => !priorityIntervals.includes(i));
          await Promise.all(priorityIntervals.map(async (interval) => {
            const chart = state.charts[interval];
            try {
              chart.candles = await fetchExchangeKlines(state.symbol, interval, CONFIG.KLINE_LIMIT);
            } catch {
              chart.candles = chart.candles || [];
            }
            chart.dirty = true;
          }));
          updateChartMetas();
          redrawCharts();
          removeChartSkeletons();
          await Promise.all(otherIntervals.map(async (interval) => {
            const chart = state.charts[interval];
            try {
              chart.candles = await fetchExchangeKlines(state.symbol, interval, CONFIG.KLINE_LIMIT);
            } catch {
              chart.candles = chart.candles || [];
            }
            chart.dirty = true;
          }));
          updateChartMetas();
          redrawCharts();
          connectBinanceFutures();
          state.chartTimer = setInterval(() => {
            if (document.hidden) return;
            const dashboardPage = document.getElementById('page-dashboard');
            if (dashboardPage && !dashboardPage.classList.contains('active')) return;
            markChartDirty();
          }, CONFIG.CHART_UPDATE_INTERVAL_MS);
          state.healthTimer = setInterval(() => {
            state.msgsInWindow = 0;
            const dashboardPage = document.getElementById('page-dashboard');
            const dashboardVisible = dashboardPage && dashboardPage.classList.contains('active');
            if (dashboardVisible && Number.isFinite(state.currentPrice)) {
              updatePriceUI();
            }
            if (navigator.onLine === false && state.wsStatus.text !== 'Inactive') {
              state.wsStatus = {
                text: 'Inactive',
                level: 'error'
              };
              updateStatus();
            }
            if (state.lastMessageTime) {
              const stale = Date.now() - state.lastMessageTime > CONFIG.STALE_RECONNECT_MS;
              if (stale && state.ws) {
                try {
                  state.ws.close();
                } catch {}
                state.ws = null;
              }
            }
            if (!document.hidden) updateCountdowns();
            if (_binanceErrorState.http418Time && (Date.now() - _binanceErrorState.http418Time > 7200000)) {
              _binanceErrorState.http418Time = null;
              hideBinanceWarningBar();
            }
          }, CONFIG.HEALTH_UPDATE_INTERVAL_MS);
          updateCountdowns();
          if (state.multiAlerts.length > 0) {
            state._wsAlreadyConnecting = true;
            startMultiAlertMonitor();
          }
        };
        const MF_LOOKBACK_BARS = 34;
        const MF_SPARKLINE_POINTS = 9;
        const MF_TIMEFRAMES = [{
          key: '30m',
          lookback: MF_LOOKBACK_BARS,
          klineInterval: '30m',
          oiPeriod: '30m'
        }, {
          key: '1H',
          lookback: MF_LOOKBACK_BARS,
          klineInterval: '1h',
          oiPeriod: '1h'
        }, {
          key: '4H',
          lookback: MF_LOOKBACK_BARS,
          klineInterval: '4h',
          oiPeriod: '4h'
        }];
        const MF_PRICE_THRESH = 1.5;
        const MF_OI_THRESH = 2.0;
        const MF_ADX_THRESH = 20;
        const MF_ADX_PERIOD = 14;
        const MF_ADX_MIN_CANDLES = 2 * MF_ADX_PERIOD + 1; // 29 — minimum candles for Wilder's ADX
        const MF_COLD_START_MIN = {
          '30m': 34,
          '1H': 34,
          '4H': 34
        };
        const MF_COLD_START_FALLBACK = 34; // Default when TF key is missing from MF_COLD_START_MIN
        const MF_SCENARIOS = {
          1: {
            name: 'Strong Uptrend',
            color: '#26D4AC',
            desc: 'Long-side likely building',
            bias: 'Long'
          },
          2: {
            name: 'Weak Rally',
            color: '#F3A052',
            desc: 'Weak Rally, no new long capital',
            bias: 'Careful Long'
          },
          3: {
            name: 'Strong Downtrend',
            color: '#F23645',
            desc: 'Short-side likely expanding',
            bias: 'Short'
          },
          4: {
            name: 'Exhaustion',
            color: '#A78BFA',
            desc: 'Unwinds likely; watch reversal',
            bias: 'Watch for reversal'
          },
          0: {
            name: 'Neutral',
            color: '#6B7280',
            desc: 'Within thresholds',
            bias: 'No directional bias'
          }
        };

        function _mfMedian(arr) {
          if (!arr || arr.length === 0) return NaN;
          // Filter out non-finite values to prevent silent wrong results
          const valid = arr.filter(v => Number.isFinite(v));
          if (valid.length === 0) return NaN;
          const sorted = [...valid].sort((a, b) => a - b); // Copy before sorting to avoid mutating valid
          const mid = Math.floor(sorted.length / 2);
          return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
        }

        function _mfMad(arr) {
          if (!arr || arr.length === 0) return NaN;
          // Filter out non-finite values before computing deviations
          const valid = arr.filter(v => Number.isFinite(v));
          if (valid.length === 0) return NaN;
          const med = _mfMedian(valid);
          if (!Number.isFinite(med)) return NaN;
          const devs = valid.map(v => Math.abs(v - med));
          return _mfMedian(devs);
        }

        function _zRobust(x, arr) {
          const med = _mfMedian(arr);
          const mad = _mfMad(arr);
          if (!Number.isFinite(med) || !Number.isFinite(mad)) return NaN;
          if (mad === 0) {
            if (x === med) return 0;
            return x > med ? 10 : -10;
          }
          return (x - med) / (mad * 1.4826);
        }

        function _wilderAdx(candles, period) {
          if (!candles || candles.length < 2 * period + 1) return NaN;
          const plusDMs = [],
            minusDMs = [],
            trs = [];
          for (let i = 1; i < candles.length; i++) {
            const hi = candles[i].high,
              lo = candles[i].low;
            const prevHi = candles[i - 1].high,
              prevLo = candles[i - 1].low,
              prevCl = candles[i - 1].close;
            const upMove = hi - prevHi;
            const downMove = prevLo - lo;
            plusDMs.push((upMove > downMove && upMove > 0) ? upMove : 0);
            minusDMs.push((downMove > upMove && downMove > 0) ? downMove : 0);
            trs.push(Math.max(hi - lo, Math.abs(hi - prevCl), Math.abs(lo - prevCl)));
          }
          if (plusDMs.length < period) return NaN;
          // RMA seed = SMA (simple average) — matches TradingView ta.rma()
          let smPlusDM = 0,
            smMinusDM = 0,
            smTR = 0;
          for (let i = 0; i < period; i++) {
            smPlusDM += plusDMs[i];
            smMinusDM += minusDMs[i];
            smTR += trs[i];
          }
          smPlusDM /= period;
          smMinusDM /= period;
          smTR /= period;
          // Guard against zero True Range in seed (all identical bars — theoretical only)
          if (smTR === 0) return NaN;
          const smPlusDMs = [smPlusDM];
          const smMinusDMs = [smMinusDM];
          const smTRs = [smTR];
          // RMA smoothing: (prev * (period-1) + current) / period
          for (let i = period; i < plusDMs.length; i++) {
            smPlusDM = (smPlusDM * (period - 1) + plusDMs[i]) / period;
            smMinusDM = (smMinusDM * (period - 1) + minusDMs[i]) / period;
            smTR = (smTR * (period - 1) + trs[i]) / period;
            smPlusDMs.push(smPlusDM);
            smMinusDMs.push(smMinusDM);
            smTRs.push(smTR);
          }
          const dxValues = [];
          for (let i = 0; i < smPlusDMs.length; i++) {
            const plusDI = smTRs[i] !== 0 ? (smPlusDMs[i] / smTRs[i]) * 100 : 0;
            const minusDI = smTRs[i] !== 0 ? (smMinusDMs[i] / smTRs[i]) * 100 : 0;
            const diSum = plusDI + minusDI;
            const dx = diSum !== 0 ? Math.abs(plusDI - minusDI) / diSum * 100 : 0;
            dxValues.push(dx);
          }
          if (dxValues.length < period) return NaN;
          // ADX seed = SMA of first period DX values
          let adx = 0;
          for (let i = 0; i < period; i++) {
            adx += dxValues[i];
          }
          adx /= period;
          // ADX smoothing: RMA (same as TradingView)
          for (let i = period; i < dxValues.length; i++) {
            adx = (adx * (period - 1) + dxValues[i]) / period;
          }
          return adx;
        }

        /**
         * Shared TF classification logic*/
        function _classifyTf(zPrice, zOi) {
          if (!Number.isFinite(zPrice) || !Number.isFinite(zOi)) return 0;
          if (zPrice > MF_PRICE_THRESH && zOi > MF_OI_THRESH) return 1;
          if (zPrice > MF_PRICE_THRESH && zOi < -MF_OI_THRESH) return 2;
          if (zPrice < -MF_PRICE_THRESH && zOi > MF_OI_THRESH) return 3;
          if (zPrice < -MF_PRICE_THRESH && zOi < -MF_OI_THRESH) return 4;
          return 0;
        }

        /**
         * Shared composite score calculation using integer-weight math.
         */
        function _computeCompositeScore(scenarios) {
          const SCENARIO_WEIGHTS = { 0: 0, 1: 100, 2: 30, 3: -100, 4: -30 };
          const TF_INT_WEIGHTS = { '30m': 30, '1H': 40, '4H': 30 };
          let score = 0;
          for (const tfKey of ['30m', '1H', '4H']) {
            const sc = scenarios[tfKey];
            if (sc) score += (SCENARIO_WEIGHTS[sc.idx] || 0) * (TF_INT_WEIGHTS[tfKey] || 0);
          }
          score = Math.round(score / 100);
          return Math.max(-100, Math.min(100, score));
        }

        function _fmtFr(frPct) {
          const sign = frPct >= 0 ? '+' : '';
          return sign + frPct.toFixed(3) + '%';
        }

        function _findBarIdxByTime(timestamps, targetTime) {
          if (!timestamps || timestamps.length === 0 || !Number.isFinite(targetTime)) return -1;
          let lo = 0, hi = timestamps.length - 1, result = -1;
          while (lo <= hi) {
            const mid = Math.floor((lo + hi) / 2);
            if (timestamps[mid] <= targetTime) {
              result = mid;
              lo = mid + 1;
            } else {
              hi = mid - 1;
            }
          }
          return result;
        }

//MULTI OI INDICATOR
        const oiPricePanel = {
          symbol: null,
          timer: null,
          _slowTimer: null,
          _refreshId: 0,
          _isRefreshing: false,
          _firstLoad: true,
          _lastComputeTime: 0,
          _wsSparklineTimer: null,
          _wsRemarkTimer: null,
          _scoreHistory: [],
          _zPrice1hHistory: [],        // Last 9 Z_Price values at 1H boundaries (8 backfilled + 1 live)
          _zOi1hHistory: [],           // Last 9 Z_OI values at 1H boundaries (8 backfilled + 1 live)
          _backfillCache: null,       // Cached backfill history points (without live score)
          _backfillZPriceCache: null,  // Cached backfill Z_Price 1H history (without live value)
          _backfillZOiCache: null,     // Cached backfill Z_OI 1H history (without live value)
          _backfillLast1hTs: null,    // Last 1H kline timestamp when backfill was computed
          _backfillCacheTime: null,   // Timestamp when backfill cache was last computed
          tfData: {},
          classification: {
            scenarios: {},
            signalStrength: 0
          },
          stats: {
            oiCurrent: null,
            fundingRate: null,
            realtimeFundingRate: null,
            oiDataStale: false,
            klinesStale: false,
            zPrice: {},
            zOi: {},
          },
          async fetchData(symbol) {
            if (this._isRefreshing) {
              this._pendingRefresh = symbol;
              return false; // Deferred — caller should skip rendering
            }
            const myId = ++this._refreshId;
            this._isRefreshing = true;
            this._pendingRefresh = null;
            if (this._firstLoad) {
              const workingEl = document.getElementById('multioiWorking');
              if (workingEl) workingEl.style.display = 'flex';
            }
            if (this.symbol !== symbol) {
              this._firstLoad = true;
              this.tfData = {}; // Clear stale data from previous symbol
              // Reset backfill cache on symbol change
              this._backfillCache = null;
              this._backfillZPriceCache = null;
              this._backfillZOiCache = null;
              this._backfillLast1hTs = null;
              this._backfillCacheTime = null;
              this._zPrice1hHistory = [];
              this._zOi1hHistory = [];
            }
            this.symbol = symbol;
            this.stats.oiCurrent = null;
            this.stats.fundingRate = null;
            this.stats.realtimeFundingRate = null;
            this.stats.oiDataStale = false;
            this.stats.klinesStale = false;
            this.stats.zPrice = {};
            this.stats.zOi = {};
            // Always start fresh — _backfillCompositeHistory() will compute the correct
            // historical composite scores from the API data. Loading stale localStorage
            // scores causes the sparkline to briefly show wrong shapes on page reload,
            // because the old session's live point (computed from mid-candle state) no
            // longer matches the fresh backfill recomputation.
            this._scoreHistory = [];
            try {
              const apiCalls = [];
              const apiLabels = [];
              for (const tf of MF_TIMEFRAMES) {
                const coldMin = MF_COLD_START_MIN[tf.key] || MF_COLD_START_FALLBACK;
                // Fetch limits: klines API supports up to 1500, OI hist API supports up to 500
                // With 1H sparkline cadence: 1H needs 42 bars (base), 30m needs 51, 4H needs 37
                // Fetch with generous buffer for alignment gaps and cold-start resilience
                const klineLimits = { '30m': 80, '1H': 60, '4H': 50 };
                const oiLimits = { '30m': 80, '1H': 60, '4H': 50 };
                const klineLimit = klineLimits[tf.key] || 50;
                const oiLimit = oiLimits[tf.key] || 50;
                apiCalls.push(fetchJsonWithTimeout(
                  `https://fapi.binance.com/fapi/v1/klines?symbol=${encodeURIComponent(symbol)}&interval=${tf.klineInterval}&limit=${klineLimit}`
                  ));
                apiLabels.push('klines_' + tf.key);
                apiCalls.push(fetchJsonWithTimeout(
                  `https://fapi.binance.com/futures/data/openInterestHist?symbol=${encodeURIComponent(symbol)}&period=${tf.oiPeriod}&limit=${oiLimit}`
                  ));
                apiLabels.push('oiHist_' + tf.key);
              }
              
              apiCalls.push(fetchJsonWithTimeout(
                `https://fapi.binance.com/fapi/v1/fundingRate?symbol=${encodeURIComponent(symbol)}&limit=3`
                ));
              apiLabels.push('frHist');
              apiCalls.push(fetchJsonWithTimeout(
                `https://fapi.binance.com/fapi/v1/openInterest?symbol=${encodeURIComponent(symbol)}`));
              apiLabels.push('oiCurrent');
              apiCalls.push(fetchJsonWithTimeout(
                `https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${encodeURIComponent(symbol)}`));
              apiLabels.push('premiumIndex');
              const results = await Promise.allSettled(apiCalls);
              if (this._refreshId !== myId) return;
              const dataMap = {};
              for (let i = 0; i < results.length; i++) {
                dataMap[apiLabels[i]] = results[i];
              }
              let anyKlineOk = false;
              let anyOiOk = false;
              // Extract last settled funding rate for context row
              let lastSettledFr = null;
              const frHistRes = dataMap['frHist'];
              if (frHistRes && frHistRes.status === 'fulfilled' && Array.isArray(frHistRes.value) && frHistRes.value.length >= 1) {
                const raw = frHistRes.value;
                // Last settled rate = second-to-last entry (last full period, excluding current in-progress)
                // If only 1 entry, use it
                const settledIdx = raw.length >= 3 ? raw.length - 2 : raw.length - 1;
                const settledFr = parseFloat(raw[settledIdx].fundingRate);
                if (Number.isFinite(settledFr)) lastSettledFr = settledFr;
              }
              if (lastSettledFr !== null) {
                this.stats.fundingRate = lastSettledFr;
              }
              for (const tf of MF_TIMEFRAMES) {
                const klinesRes = dataMap['klines_' + tf.key];
                const oiHistRes = dataMap['oiHist_' + tf.key];
                const tfData = {
                  closes: [],
                  volumes: [],
                  quoteVolumes: [],
                  oi: [],
                  candles: [],
                  klineTimestamps: [],
                  oiTimestamps: []
                };
                if (klinesRes.status === 'fulfilled' && Array.isArray(klinesRes.value) && klinesRes.value.length >=
                  3) {
                  const raw = klinesRes.value;
                  for (let i = 0; i < raw.length - 1; i++) {
                    const c = parseFloat(raw[i][4]);
                    const v = parseFloat(raw[i][5]);
                    const qv = parseFloat(raw[i][7]);
                    const h = parseFloat(raw[i][2]);
                    const l = parseFloat(raw[i][3]);
                    const ts = parseInt(raw[i][6]);
                    if (Number.isFinite(h) && Number.isFinite(l) && Number.isFinite(c)) {
                      tfData.candles.push({
                        high: h,
                        low: l,
                        close: c
                      });
                      tfData.closes.push(c);
                    }
                    if (Number.isFinite(v)) tfData.volumes.push(v);
                    if (Number.isFinite(qv)) tfData.quoteVolumes.push(qv);
                    if (Number.isFinite(ts)) tfData.klineTimestamps.push(ts);
                  }
                  anyKlineOk = true;
                } else {
                  this.stats.klinesStale = true;
                  if (klinesRes.status === 'rejected') console.warn(`MultiOI: ${tf.key} klines fetch failed:`,
                    klinesRes.reason);
                  else if (klinesRes.status === 'fulfilled' && (!Array.isArray(klinesRes.value) || klinesRes.value
                      .length < 3)) console.warn(
                    `MultiOI: ${tf.key} klines returned ${Array.isArray(klinesRes.value) ? klinesRes.value.length : 0} bars (need >=3)`
                    );
                }
                if (oiHistRes.status === 'fulfilled' && Array.isArray(oiHistRes.value) && oiHistRes.value.length >=
                  3) {
                  const raw = oiHistRes.value;
                  for (let i = 0; i < raw.length - 1; i++) {
                    const oi = parseFloat(raw[i].sumOpenInterest);
                    const ts = parseInt(raw[i].timestamp);
                    if (Number.isFinite(oi)) tfData.oi.push(oi);
                    if (Number.isFinite(ts)) tfData.oiTimestamps.push(ts);
                  }
                  anyOiOk = true;
                } else {
                  this.stats.oiDataStale = true;
                  if (oiHistRes.status === 'rejected') console.warn(`MultiOI: ${tf.key} OI hist fetch failed:`,
                    oiHistRes.reason);
                  else if (oiHistRes.status === 'fulfilled' && (!Array.isArray(oiHistRes.value) || oiHistRes.value
                      .length < 3)) console.warn(
                    `MultiOI: ${tf.key} OI hist returned ${Array.isArray(oiHistRes.value) ? oiHistRes.value.length : 0} bars (need >=3)`
                    );
                }
                // Funding rate history is contract-level, assigned once below
                if (tfData.klineTimestamps.length > 0 && tfData.oiTimestamps.length > 0) {
                  const kStart = tfData.klineTimestamps[0];
                  const kEnd = tfData.klineTimestamps[tfData.klineTimestamps.length - 1];
                  const oStart = tfData.oiTimestamps[0];
                  const oEnd = tfData.oiTimestamps[tfData.oiTimestamps.length - 1];
                  // klineTimestamps store close times, oiTimestamps store start times.
                  // For the same period, close_time ≈ start_time + period_duration.
                  const oiPeriodMs = tfData.oiTimestamps.length >= 2
                    ? tfData.oiTimestamps[1] - tfData.oiTimestamps[0]
                    : 0;
                  const alignStart = Math.max(kStart - oiPeriodMs, oStart);
                  const alignEnd = Math.min(kEnd, oEnd + oiPeriodMs);
                  let kStartIdx = tfData.klineTimestamps.findIndex(t => t >= alignStart);
                  let kEndIdx = -1;
                  for (let i = tfData.klineTimestamps.length - 1; i >= 0; i--) {
                    if (tfData.klineTimestamps[i] <= alignEnd) {
                      kEndIdx = i;
                      break;
                    }
                  }
                  if (kStartIdx >= 0 && kEndIdx >= kStartIdx && (alignStart > kStart || alignEnd < kEnd)) {
                    tfData.closes = tfData.closes.slice(kStartIdx, kEndIdx + 1);
                    tfData.volumes = tfData.volumes.slice(kStartIdx, kEndIdx + 1);
                    tfData.quoteVolumes = tfData.quoteVolumes.slice(kStartIdx, kEndIdx + 1);
                    tfData.candles = tfData.candles.slice(kStartIdx, kEndIdx + 1);
                    tfData.klineTimestamps = tfData.klineTimestamps.slice(kStartIdx, kEndIdx + 1);
                  }
                  let oStartIdx = tfData.oiTimestamps.findIndex(t => t >= alignStart);
                  let oEndIdx = -1;
                  for (let i = tfData.oiTimestamps.length - 1; i >= 0; i--) {
                    if (tfData.oiTimestamps[i] <= alignEnd) {
                      oEndIdx = i;
                      break;
                    }
                  }
                  if (oStartIdx >= 0 && oEndIdx >= oStartIdx && (alignStart > oStart || alignEnd < oEnd)) {
                    tfData.oi = tfData.oi.slice(oStartIdx, oEndIdx + 1);
                    tfData.oiTimestamps = tfData.oiTimestamps.slice(oStartIdx, oEndIdx + 1);
                  }
                }
                const N = tf.lookback;
                // Each TF needs enough bars for lookback + backfill at the 1H cadence
                // 1H (base): N + (SPARKLINE_POINTS-1) = 34 + 8 = 42
                // 30m (2× finer): N + (SPARKLINE_POINTS-1)×2 + 1 = 34 + 16 + 1 = 51
                // 4H (4× coarser): N + ceil((SPARKLINE_POINTS-1)/4) + 1 = 34 + 2 + 1 = 37
                const maxKeepMap = {
                  '1H': N + (MF_SPARKLINE_POINTS - 1),                              // 42
                  '30m': N + (MF_SPARKLINE_POINTS - 1) * 2 + 1,                     // 51
                  '4H': N + Math.ceil((MF_SPARKLINE_POINTS - 1) / 4) + 1             // 37
                };
                const maxKeep = maxKeepMap[tf.key] || (N + MF_SPARKLINE_POINTS - 1);
                if (tfData.closes.length > maxKeep) tfData.closes = tfData.closes.slice(-maxKeep);
                if (tfData.volumes.length > maxKeep) tfData.volumes = tfData.volumes.slice(-maxKeep);
                if (tfData.quoteVolumes.length > maxKeep) tfData.quoteVolumes = tfData.quoteVolumes.slice(-maxKeep);
                if (tfData.candles.length > maxKeep) tfData.candles = tfData.candles.slice(-maxKeep);
                if (tfData.klineTimestamps.length > maxKeep) tfData.klineTimestamps = tfData.klineTimestamps.slice(-maxKeep);
                if (tfData.oi.length > maxKeep) tfData.oi = tfData.oi.slice(-maxKeep);
                if (tfData.oiTimestamps.length > maxKeep) tfData.oiTimestamps = tfData.oiTimestamps.slice(-maxKeep);
                if (tfData.closes.length > 0 && tfData.oi.length > 0 && tfData.closes.length !== tfData.oi.length) {
                  // Trim from the start to keep the most recent aligned data
                  const minLen = Math.min(tfData.closes.length, tfData.oi.length);
                  console.warn(
                    `MultiOI: ${tf.key} closes/oi length mismatch after trimming (${tfData.closes.length} vs ${tfData.oi.length}), trimming both to ${minLen} from start`
                    );
                  tfData.closes = tfData.closes.slice(-minLen);
                  tfData.volumes = tfData.volumes.slice(-minLen);
                  tfData.quoteVolumes = tfData.quoteVolumes.slice(-minLen);
                  tfData.candles = tfData.candles.slice(-minLen);
                  tfData.klineTimestamps = tfData.klineTimestamps.slice(-minLen);
                  tfData.oi = tfData.oi.slice(-minLen);
                  tfData.oiTimestamps = tfData.oiTimestamps.slice(-minLen);
                  // Cross-check: verify first and last timestamps still align
                  if (tfData.klineTimestamps.length > 0 && tfData.oiTimestamps.length > 0) {
                    const firstK = tfData.klineTimestamps[0];
                    const firstO = tfData.oiTimestamps[0];
                    const lastK = tfData.klineTimestamps[tfData.klineTimestamps.length - 1];
                    const lastO = tfData.oiTimestamps[tfData.oiTimestamps.length - 1];
                    if (Math.abs(firstK - firstO) > 60000 || Math.abs(lastK - lastO) > 60000) {
                      console.warn(`MultiOI: ${tf.key} timestamp misalignment after mismatch trim — first(k=${firstK},o=${firstO}), last(k=${lastK},o=${lastO})`);
                    }
                  }
                }
                const coldMin = MF_COLD_START_MIN[tf.key] || MF_COLD_START_FALLBACK;
                if (tfData.closes.length < coldMin || tfData.oi.length < coldMin || tfData.candles.length <
                  MF_ADX_MIN_CANDLES) {
                  const parts = [];
                  if (tfData.closes.length < coldMin) parts.push('closes=' + tfData.closes.length + '<' + coldMin);
                  if (tfData.oi.length < coldMin) parts.push('oi=' + tfData.oi.length + '<' + coldMin);
                  if (tfData.candles.length < MF_ADX_MIN_CANDLES) parts.push('candles=' + tfData.candles.length + '<' +
                    MF_ADX_MIN_CANDLES);
                  console.warn(`MultiOI: ${tf.key} post-alignment data low — ${parts.join(', ')}`);
                }
                this.tfData[tf.key] = tfData;
              }
              if (!anyKlineOk) this.stats.klinesStale = true;
              if (!anyOiOk) this.stats.oiDataStale = true;
              if (dataMap.oiCurrent.status === 'fulfilled' && dataMap.oiCurrent.value && dataMap.oiCurrent.value
                .openInterest) {
                this.stats.oiCurrent = parseFloat(dataMap.oiCurrent.value.openInterest);
              }
              // Real-time funding rate from premiumIndex
              if (dataMap.premiumIndex.status === 'fulfilled' && dataMap.premiumIndex.value &&
                dataMap.premiumIndex.value.lastFundingRate !== undefined) {
                const rtFr = parseFloat(dataMap.premiumIndex.value.lastFundingRate);
                if (Number.isFinite(rtFr)) this.stats.realtimeFundingRate = rtFr;
              }
            } catch (e) {
              if (this._refreshId !== myId) return;
              console.warn('MultiOI: fetch error', e);
            } finally {
              if (this._refreshId === myId) {
                this._isRefreshing = false;
                if (this._pendingRefresh) {
                  const pending = this._pendingRefresh;
                  this._pendingRefresh = null;
                  // Only dispatch if the pending symbol is still the current one
                  if (pending === this.symbol) {
                    Promise.resolve().then(() => this.fetchData(pending));
                  }
                }
              }
            }
          },
          computeClassification() {
            const scenarios = {};
            for (const tf of MF_TIMEFRAMES) {
              const d = this.tfData[tf.key];
              if (!d) {
                scenarios[tf.key] = {
                  idx: 0,
                  reason: 'No data'
                };
                continue;
              }
              const N = tf.lookback;
              const closes = d.closes;
              const oi = d.oi;
              const candles = d.candles;
              const coldMin = MF_COLD_START_MIN[tf.key] || MF_COLD_START_FALLBACK;
              if (closes.length < coldMin || oi.length < coldMin || candles.length < MF_ADX_MIN_CANDLES) {
                const parts = [];
                if (closes.length < coldMin) parts.push('closes=' + closes.length + '<' + coldMin);
                if (oi.length < coldMin) parts.push('oi=' + oi.length + '<' + coldMin);
                if (candles.length < MF_ADX_MIN_CANDLES) parts.push('candles=' + candles.length + '<' + MF_ADX_MIN_CANDLES +
                  ' (ADX)');
                if (closes.length > 0 || oi.length > 0) {
                  console.warn(`MultiOI: ${tf.key} cold start — ${parts.join(', ')}`);
                }
                scenarios[tf.key] = {
                  idx: 0,
                  coldStart: true,
                  coldStartParts: parts,
                  reason: 'Insufficient data (cold start — ' + parts.join(', ') + ')'
                };
                continue;
              }
              // Compute Z-scores unconditionally — they are statistical measurements
              // that are meaningful regardless of trend strength. ADX only gates classification.
              const closesN = closes.slice(-N);
              const oiN = oi.slice(-N);
              const curPrice = closesN[closesN.length - 1];
              const curOi = oiN[oiN.length - 1];
              // Compute baseline from all bars except current to avoid self-inclusion bias
              const closesBaseline = closesN.slice(0, -1);
              const oiBaseline = oiN.slice(0, -1);
              const zPrice = closesBaseline.length > 0 ? _zRobust(curPrice, closesBaseline) : NaN;
              const zOi = oiBaseline.length > 0 ? _zRobust(curOi, oiBaseline) : NaN;
              this.stats.zPrice[tf.key] = zPrice;
              this.stats.zOi[tf.key] = zOi;
              // ADX gate — only gates classification (which scenario), not the Z-score values
              let adxValue = NaN;
              if (candles.length >= MF_ADX_MIN_CANDLES) {
                adxValue = _wilderAdx(candles.slice(-MF_ADX_MIN_CANDLES), MF_ADX_PERIOD);
              }
              const adxOk = Number.isFinite(adxValue) && adxValue > MF_ADX_THRESH;
              if (!adxOk) {
                scenarios[tf.key] = {
                  idx: 0,
                  zPrice: zPrice,
                  zOi: zOi,
                  adx: adxValue,
                  coldStart: false,
                  reason: !Number.isFinite(adxValue) ?
                    'No trend detected (ADX returned NaN — possibly insufficient price data)' :
                    'No trend detected (ADX ' + adxValue.toFixed(1) + ' < ' + MF_ADX_THRESH + ')'
                };
                continue;
              }
              const finalScenario = _classifyTf(zPrice, zOi);
              let reason = '';
              if (finalScenario === 0) {

                if (!Number.isFinite(zPrice) || !Number.isFinite(zOi)) {
                  reason = 'Z-score not computable';
                } else {
                  reason = 'Z-scores below thresholds (|Z_P|<=' + MF_PRICE_THRESH + ' or |Z_OI|<=' + MF_OI_THRESH + ')';
                }
              }
              scenarios[tf.key] = {
                idx: finalScenario,
                zPrice: zPrice,
                zOi: zOi,
                adx: adxValue,
                coldStart: false,
                reason: finalScenario === 0 ? reason : ''
              };
            }
            // Compute composite score using shared helper (integer-weight math)
            const signalStrength = _computeCompositeScore(scenarios);
            this.classification = {
              scenarios,
              signalStrength
            };
            this._firstLoad = false;
            const workingEl = document.getElementById('multioiWorking');
            if (workingEl) workingEl.style.display = 'none';
            return this.classification;
          },
          /**
           * Backfill historical composite scores at 1H candle boundaries.
           * For each of the last (MF_SPARKLINE_POINTS - 1) completed 1H candles,
           * compute a full 3-TF composite score using the data available at that point.
           * The current live score is always the last point.
           */
          _backfillCompositeHistory() {
            const d4h = this.tfData['4H'];
            const d1h = this.tfData['1H'];
            const d30m = this.tfData['30m'];
            if (!d1h || !d1h.closes || d1h.closes.length < 2) return;
            // Check if 1H candle boundary has changed since last backfill
            const current1hTs = d1h.klineTimestamps && d1h.klineTimestamps.length > 0
              ? d1h.klineTimestamps[d1h.klineTimestamps.length - 1]
              : null;
            const CACHE_STALE_MS = 2 * 60 * 1000;
            if (this._backfillCache && this._backfillLast1hTs !== null && current1hTs === this._backfillLast1hTs
                && this._backfillCacheTime !== null && (Date.now() - this._backfillCacheTime) < CACHE_STALE_MS) {
              // Just append live score to cached backfill
              const cached = this._backfillCache;
              const history = [...cached];
              if (this.classification && Number.isFinite(this.classification.signalStrength)) {
                history.push(this.classification.signalStrength);
              }
              if (history.length > 0) {
                this._scoreHistory = history.slice(-MF_SPARKLINE_POINTS);
              }
              // Also append live Z_Price/Z_OI 1H to cached backfill
              const cachedZP = this._backfillZPriceCache || [];
              const cachedZO = this._backfillZOiCache || [];
              const zpHistory = [...cachedZP];
              const zoHistory = [...cachedZO];
              const liveZP = this.stats.zPrice['1H'];
              const liveZO = this.stats.zOi['1H'];
              if (Number.isFinite(liveZP)) zpHistory.push(liveZP);
              if (Number.isFinite(liveZO)) zoHistory.push(liveZO);
              if (zpHistory.length > 0) this._zPrice1hHistory = zpHistory.slice(-MF_SPARKLINE_POINTS);
              if (zoHistory.length > 0) this._zOi1hHistory = zoHistory.slice(-MF_SPARKLINE_POINTS);
              return;
            }
            // Full recomputation needed (new 1H candle or first run)
            // Number of historical points to backfill (current live score = last point)
            const backfillCount = MF_SPARKLINE_POINTS - 1;
            const N = MF_LOOKBACK_BARS;
            const coldMin1h = MF_COLD_START_MIN['1H'] || MF_COLD_START_FALLBACK;
            if (d1h.closes.length < N + 1) return; // Not enough for even 1 point
            // Determine how many points we can actually compute
            const maxPoints = Math.min(backfillCount, d1h.closes.length - N);
            const history = [];
            const zpHistory = [];  // Z_Price 1H backfill
            const zoHistory = [];  // Z_OI 1H backfill
            for (let p = maxPoints; p >= 1; p--) {
              // For historical point p, the "current" 1H bar is at index closes.length - 1 - p
              // The lookback window for Z-score is the N bars before that
              const endIdx = d1h.closes.length - 1 - p; // the bar being classified
              const startIdx = endIdx - N + 1; // lookback start (N bars inclusive)
              if (startIdx < 0) continue;
              // Timestamp of the 1H bar being classified — used for cross-TF alignment
              const target1hCloseTime = (d1h.klineTimestamps && endIdx < d1h.klineTimestamps.length) ? d1h.klineTimestamps[endIdx] : null;

              // ─── 1H ───
              let zPrice1h = NaN, zOi1h = NaN, adx1h = NaN;
              const closes1h = d1h.closes.slice(startIdx, endIdx + 1);
              const oi1h = d1h.oi && d1h.oi.length > endIdx ? d1h.oi.slice(startIdx, endIdx + 1) : [];
              const candles1h = d1h.candles && d1h.candles.length > endIdx
                ? d1h.candles.slice(Math.max(0, endIdx - (MF_ADX_MIN_CANDLES - 1)), endIdx + 1) : [];
              // Compute Z-scores unconditionally — they are meaningful regardless of ADX
              if (closes1h.length >= coldMin1h && oi1h.length >= coldMin1h) {
                const curPrice1h = closes1h[closes1h.length - 1];
                const curOi1h = oi1h[oi1h.length - 1];
                const baselineClose1h = closes1h.slice(0, -1);
                const baselineOi1h = oi1h.length > 1 ? oi1h.slice(0, -1) : [];
                zPrice1h = baselineClose1h.length > 0 ? _zRobust(curPrice1h, baselineClose1h) : NaN;
                zOi1h = baselineOi1h.length > 0 ? _zRobust(curOi1h, baselineOi1h) : NaN;
              }
              // ADX computed separately — only gates classification, not Z-score values
              if (candles1h.length >= MF_ADX_MIN_CANDLES) {
                adx1h = _wilderAdx(candles1h, MF_ADX_PERIOD);
              }

              // ─── 30m ───
              // Timestamp-aligned: find 30m bar whose close time <= 1H bar's close time.
              // Lookback = N bars inclusive ending at the aligned bar (same as live).
              let zPrice30m = NaN, zOi30m = NaN, adx30m = NaN;
              const coldMin30m = MF_COLD_START_MIN['30m'] || MF_COLD_START_FALLBACK;
              if (d30m && d30m.closes && target1hCloseTime !== null) {
                const endIdx30m = _findBarIdxByTime(d30m.klineTimestamps, target1hCloseTime);
                if (endIdx30m >= 0) {
                  const startIdx30m = endIdx30m - N + 1;
                  if (startIdx30m >= 0) {
                    const closes30m = d30m.closes.slice(startIdx30m, endIdx30m + 1);
                    const oi30m = d30m.oi && d30m.oi.length > endIdx30m ? d30m.oi.slice(startIdx30m, endIdx30m + 1) : [];
                    const candles30m = d30m.candles && d30m.candles.length > endIdx30m
                      ? d30m.candles.slice(Math.max(0, endIdx30m - (MF_ADX_MIN_CANDLES - 1)), endIdx30m + 1) : [];
                    // Compute Z-scores unconditionally — they are meaningful regardless of ADX
                    if (closes30m.length >= coldMin30m && oi30m.length >= coldMin30m) {
                      const curPrice30m = closes30m[closes30m.length - 1];
                      const curOi30m = oi30m[oi30m.length - 1];
                      const blClose30m = closes30m.slice(0, -1);
                      const blOi30m = oi30m.length > 1 ? oi30m.slice(0, -1) : [];
                      zPrice30m = blClose30m.length > 0 ? _zRobust(curPrice30m, blClose30m) : NaN;
                      zOi30m = blOi30m.length > 0 ? _zRobust(curOi30m, blOi30m) : NaN;
                    }
                    // ADX computed separately — only gates classification, not Z-score values
                    if (candles30m.length >= MF_ADX_MIN_CANDLES) {
                      adx30m = _wilderAdx(candles30m, MF_ADX_PERIOD);
                    }
                  }
                }
              }

              // ─── 4H ───
              // Timestamp-aligned: find 4H bar whose close time <= 1H bar's close time.
              // Lookback = N bars inclusive ending at the aligned bar (same as live).
              let zPrice4h = NaN, zOi4h = NaN, adx4h = NaN;
              const coldMin4h = MF_COLD_START_MIN['4H'] || MF_COLD_START_FALLBACK;
              if (d4h && d4h.closes && target1hCloseTime !== null) {
                const endIdx4h = _findBarIdxByTime(d4h.klineTimestamps, target1hCloseTime);
                if (endIdx4h >= 0) {
                  const startIdx4h = endIdx4h - N + 1;
                  if (startIdx4h >= 0) {
                    const closes4h = d4h.closes.slice(startIdx4h, endIdx4h + 1);
                    const oi4h = d4h.oi && d4h.oi.length > endIdx4h ? d4h.oi.slice(startIdx4h, endIdx4h + 1) : [];
                    const candles4h = d4h.candles && d4h.candles.length > endIdx4h
                      ? d4h.candles.slice(Math.max(0, endIdx4h - (MF_ADX_MIN_CANDLES - 1)), endIdx4h + 1) : [];
                    // Compute Z-scores unconditionally — they are meaningful regardless of ADX
                    if (closes4h.length >= coldMin4h && oi4h.length >= coldMin4h) {
                      const curPrice4h = closes4h[closes4h.length - 1];
                      const curOi4h = oi4h[oi4h.length - 1];
                      const blClose4h = closes4h.slice(0, -1);
                      const blOi4h = oi4h.length > 1 ? oi4h.slice(0, -1) : [];
                      zPrice4h = blClose4h.length > 0 ? _zRobust(curPrice4h, blClose4h) : NaN;
                      zOi4h = blOi4h.length > 1 ? _zRobust(curOi4h, blOi4h) : NaN;
                    }
                    // ADX computed separately — only gates classification, not Z-score values
                    if (candles4h.length >= MF_ADX_MIN_CANDLES) {
                      adx4h = _wilderAdx(candles4h, MF_ADX_PERIOD);
                    }
                  }
                }
              }

              // Classify each TF using shared helper (same as computeClassification — including ADX gate)
              const scenarios = {};
              for (const [tfKey, zp, zo, adxVal] of [['30m', zPrice30m, zOi30m, adx30m], ['1H', zPrice1h, zOi1h, adx1h], ['4H', zPrice4h, zOi4h, adx4h]]) {
                const adxOk = Number.isFinite(adxVal) && adxVal > MF_ADX_THRESH;
                scenarios[tfKey] = { idx: adxOk ? _classifyTf(zp, zo) : 0 };
              }
              // Compute composite score using shared helper
              const score = _computeCompositeScore(scenarios);
              history.push(score);
              // Also store 1H Z_Price and Z_OI for their sparklines
              zpHistory.push(Number.isFinite(zPrice1h) ? zPrice1h : NaN);
              zoHistory.push(Number.isFinite(zOi1h) ? zOi1h : NaN);
            }
            // Cache the backfill history (without live score) for reuse until 1H candle closes
            this._backfillCache = history.slice();
            this._backfillZPriceCache = zpHistory.slice();
            this._backfillZOiCache = zoHistory.slice();
            this._backfillLast1hTs = current1hTs;
            this._backfillCacheTime = Date.now();
            // Append current live score as the last point
            if (this.classification && Number.isFinite(this.classification.signalStrength)) {
              history.push(this.classification.signalStrength);
            }
            if (history.length > 0) {
              this._scoreHistory = history.slice(-MF_SPARKLINE_POINTS);
            }
            // Append current live Z_Price/Z_OI 1H as the last point
            const liveZP = this.stats.zPrice['1H'];
            const liveZO = this.stats.zOi['1H'];
            if (Number.isFinite(liveZP)) zpHistory.push(liveZP);
            if (Number.isFinite(liveZO)) zoHistory.push(liveZO);
            if (zpHistory.length > 0) this._zPrice1hHistory = zpHistory.slice(-MF_SPARKLINE_POINTS);
            if (zoHistory.length > 0) this._zOi1hHistory = zoHistory.slice(-MF_SPARKLINE_POINTS);
          },
          renderQuadrant() {
            const wrap = document.getElementById('multioiQuadrantWrap');
            if (!wrap) return;
            // Cold-start progress overlay
            const coldStartOverlay = document.getElementById('coldStartOverlay');
            const coldStartTfs = document.getElementById('coldStartTfs');
            if (coldStartOverlay && coldStartTfs && this.classification && this.classification.scenarios) {
              const anyColdStart = MF_TIMEFRAMES.some(tf => {
                const sc = this.classification.scenarios[tf.key];
                return sc && sc.coldStart;
              });
              if (anyColdStart) {
                let html = '';
                for (const tf of MF_TIMEFRAMES) {
                  const d = this.tfData[tf.key];
                  const sc = this.classification.scenarios[tf.key];
                  if (sc && sc.coldStart) {
                    const coldMin = MF_COLD_START_MIN[tf.key] || MF_COLD_START_FALLBACK;
                    const closesLen = d ? d.closes.length : 0;
                    const oiLen = d ? d.oi.length : 0;
                    const candlesLen = d ? d.candles.length : 0;
                    const bestLen = Math.min(closesLen, oiLen, candlesLen);
                    const adxReady = candlesLen >= MF_ADX_MIN_CANDLES;
                    const statusClass = bestLen >= coldMin && adxReady ? 'ready' : (bestLen > 0 ? 'partial' : 'empty');
                    const displayMin = Math.max(coldMin, MF_ADX_MIN_CANDLES);
                    html += '<div class="multioi-coldstart-overlay__tf"><span class="multioi-coldstart-overlay__tf-label">' +
                      tf.key + '</span><span class="multioi-coldstart-overlay__tf-value ' + statusClass + '">' +
                      (statusClass === 'ready' ? '&#x2713;' : bestLen + '/' + displayMin) + '</span></div>';
                  } else {
                    html += '<div class="multioi-coldstart-overlay__tf"><span class="multioi-coldstart-overlay__tf-label">' +
                      tf.key + '</span><span class="multioi-coldstart-overlay__tf-value ready">&#x2713;</span></div>';
                  }
                }
                coldStartTfs.innerHTML = html;
                coldStartOverlay.style.display = 'flex';
              } else {
                coldStartOverlay.style.display = 'none';
              }
            } else if (coldStartOverlay) {
              coldStartOverlay.style.display = 'none';
            }
            const Q_MAX_Z = 3.5;
            const tfKeys = ['30m', '1H', '4H'];
            const tfBubbleClass = {
              '30m': 'quadrant-bubble--30m',
              '1H': 'quadrant-bubble--1h',
              '4H': 'quadrant-bubble--4h'
            };
            const tfSizes = {
              '30m': 29,
              '1H': 34,
              '4H': 39
            };
            const cellLookup = {
              'pos_pos': 'qCellSU',
              'pos_neg': 'qCellWR',
              'neg_pos': 'qCellSD',
              'neg_neg': 'qCellEX'
            };
            const cellMap = {
              1: 'qCellSU',
              2: 'qCellWR',
              3: 'qCellSD',
              4: 'qCellEX'
            };
            const extLabelMap = {
              1: 'qExtLabelSU',
              2: 'qExtLabelWR',
              3: 'qExtLabelSD',
              4: 'qExtLabelEX'
            };
            const activeMap = {
              1: 'active--su',
              2: 'active--wr',
              3: 'active--sd',
              4: 'active--ex'
            };
            for (const id of Object.values(cellMap)) {
              const el = document.getElementById(id);
              if (el) {
                el.classList.remove('active', 'active--su', 'active--wr', 'active--sd', 'active--ex');
              }
            }
            for (const id of Object.values(extLabelMap)) {
              const el = document.getElementById(id);
              if (el) {
                el.classList.remove('active--su', 'active--wr', 'active--sd', 'active--ex');
              }
            }
            if (this.classification && this.classification.scenarios) {
              const activeCells = new Set();
              for (const tf of MF_TIMEFRAMES) {
                const sc = this.classification.scenarios[tf.key];
                if (sc && sc.idx > 0) activeCells.add(sc.idx);
              }
              for (const idx of activeCells) {
                const el = document.getElementById(cellMap[idx]);
                if (el) {
                  el.classList.add('active', activeMap[idx]);
                }
                const extEl = document.getElementById(extLabelMap[idx]);
                if (extEl) {
                  extEl.classList.add(activeMap[idx]);
                }
              }
            }
            let allZP = [],
              allZO = [];
            for (const tfKey of tfKeys) {
              const sc = this.classification && this.classification.scenarios[tfKey];
              if (sc && sc.idx > 0) {
                if (Number.isFinite(sc.zPrice)) allZP.push(sc.zPrice);
                if (Number.isFinite(sc.zOi)) allZO.push(sc.zOi);
              }
            }
            const zPmin = allZP.length > 0 ? Math.min(...allZP) : -Q_MAX_Z;
            const zPmax = allZP.length > 0 ? Math.max(...allZP) : Q_MAX_Z;
            const zOmin = allZO.length > 0 ? Math.min(...allZO) : -Q_MAX_Z;
            const zOmax = allZO.length > 0 ? Math.max(...allZO) : Q_MAX_Z;
            const pLo = Math.min(zPmin, 0);
            const pHi = Math.max(zPmax, 0);
            const oLo = Math.min(zOmin, 0);
            const oHi = Math.max(zOmax, 0);
            const normMaxP = Math.max(Math.abs(pLo), Math.abs(pHi), Q_MAX_Z);
            const normMaxO = Math.max(Math.abs(oLo), Math.abs(oHi), Q_MAX_Z);
            const Q_PAD = 12;

            function cellPosition(zPrice, zOi, bubbleSize) {
              const priceUp = zPrice >= 0;
              const oiUp = zOi >= 0;
              const fracP = Math.min(Math.abs(zPrice) / normMaxP, 1.0);
              const fracO = Math.min(Math.abs(zOi) / normMaxO, 1.0);
              const usableLo = Q_PAD;
              const usableHi = 100 - Q_PAD;
              const usableSpan = usableHi - usableLo;
              let leftPct;
              if (oiUp) {
                leftPct = usableHi - fracO * usableSpan;
              } else {
                leftPct = usableLo + fracO * usableSpan;
              }
              let topPct;
              if (priceUp) {
                topPct = usableHi - fracP * usableSpan;
              } else {
                topPct = usableLo + fracP * usableSpan;
              }
              leftPct = Math.max(Q_PAD, Math.min(100 - Q_PAD, leftPct));
              topPct = Math.max(Q_PAD, Math.min(100 - Q_PAD, topPct));
              return {
                leftPct,
                topPct
              };
            }
            const cellDots = {};
            const dotData = {};
            for (const tfKey of tfKeys) {
              const sc = this.classification && this.classification.scenarios[tfKey];
              const zPrice = sc && Number.isFinite(sc.zPrice) ? sc.zPrice : 0;
              const zOi = sc && Number.isFinite(sc.zOi) ? sc.zOi : 0;
              const scenarioIdx = sc ? sc.idx : 0;
              const size = tfSizes[tfKey];
              if (scenarioIdx === 0) continue;
              const priceSign = zPrice >= 0 ? 'pos' : 'neg';
              const oiSign = zOi >= 0 ? 'pos' : 'neg';
              const cellKey = priceSign + '_' + oiSign;
              const cellId = cellLookup[cellKey];
              dotData[tfKey] = {
                zPrice,
                zOi,
                scenarioIdx,
                size,
                cellId
              };
              const pos = cellPosition(zPrice, zOi, size);
              if (!cellDots[cellId]) cellDots[cellId] = [];
              cellDots[cellId].push({
                tfKey,
                pos,
                size
              });
            }
            const MIN_DOT_DIST = 22;
            for (const cellId of Object.keys(cellDots)) {
              const dots = cellDots[cellId];
              if (dots.length < 2) continue;
              dots.sort((a, b) => tfKeys.indexOf(a.tfKey) - tfKeys.indexOf(b.tfKey));
              for (let i = 0; i < dots.length; i++) {
                for (let j = i + 1; j < dots.length; j++) {
                  const dLeft = dots[j].pos.leftPct - dots[i].pos.leftPct;
                  const dTop = dots[j].pos.topPct - dots[i].pos.topPct;
                  const dist = Math.sqrt(dLeft * dLeft + dTop * dTop);
                  if (dist < MIN_DOT_DIST) {
                    const push = (MIN_DOT_DIST - dist) / 2 + 2;
                    const safeDist = dist > 0.01 ? dist : 0.01;
                    const unitX = dLeft / safeDist;
                    const unitY = dTop / safeDist;
                    dots[i].pos.leftPct -= unitX * push;
                    dots[i].pos.topPct -= unitY * push;
                    dots[j].pos.leftPct += unitX * push;
                    dots[j].pos.topPct += unitY * push;
                    const PAD = 12;
                    for (const d of [dots[i], dots[j]]) {
                      d.pos.leftPct = Math.max(PAD, Math.min(100 - PAD, d.pos.leftPct));
                      d.pos.topPct = Math.max(PAD, Math.min(100 - PAD, d.pos.topPct));
                    }
                  }
                }
              }
            }
            const tooltipLayer = document.getElementById('quadrantTooltipLayer');
            const quadrantWrap = document.getElementById('multioiQuadrantWrap');
            for (const tfKey of tfKeys) {
              const sc = this.classification && this.classification.scenarios[tfKey];
              const scenarioIdx = sc ? sc.idx : 0;
              const bubbleId = 'qBubble_' + tfKey;
              let bubble = document.getElementById(bubbleId);
              if (scenarioIdx === 0) {
                if (bubble) {
                  bubble.style.display = 'none';
                }
                const overlayTip = document.getElementById('qOverlayTip_' + tfKey);
                if (overlayTip) overlayTip.style.display = 'none';
                continue;
              }
              const data = dotData[tfKey];
              if (!data) continue;
              const targetEl = data.cellId ? document.getElementById(data.cellId) : null;
              if (!targetEl) continue;
              const cellDotEntry = cellDots[data.cellId] && cellDots[data.cellId].find(d => d.tfKey === tfKey);
              const pos = cellDotEntry ? cellDotEntry.pos : cellPosition(data.zPrice, data.zOi, data.size);
              if (!bubble) {
                bubble = document.createElement('div');
                bubble.id = bubbleId;
                bubble.className = 'quadrant-bubble ' + tfBubbleClass[tfKey];
                bubble.setAttribute('tabindex', '0');
                bubble.setAttribute('role', 'button');
                bubble.setAttribute('aria-label', tfKey + ' position');
                const label = document.createElement('span');
                label.className = 'quadrant-bubble-label';
                bubble.appendChild(label);
              }
              const labelEl = bubble.querySelector('.quadrant-bubble-label');
              if (labelEl && sc) {
                const zP = Number.isFinite(sc.zPrice) ? (sc.zPrice >= 0 ? '+' : '') + sc.zPrice.toFixed(2) : '--';
                const zO = Number.isFinite(sc.zOi) ? (sc.zOi >= 0 ? '+' : '') + sc.zOi.toFixed(2) : '--';
                labelEl.innerHTML = '<span style="display:block;line-height:1;font-size:1.1em;font-weight:900;color:#fff;text-shadow:0 1px 4px rgba(0,0,0,1),0 0 8px rgba(0,0,0,0.9);">' + tfKey + '<\/span><span style="display:block;line-height:0.95;font-size:0.62em;font-weight:700;margin-top:1px;color:#FFFFFF;text-shadow:0 1px 4px rgba(0,0,0,1),0 0 8px rgba(0,0,0,0.9);">' + zP +
                  '<\/span><span style="display:block;line-height:0.95;font-size:0.62em;font-weight:800;margin-top:1px;color:#FFFFFF;text-shadow:0 1px 4px rgba(0,0,0,1),0 0 8px rgba(0,0,0,0.9);">' + zO + '<\/span>';
              }
              if (bubble.parentElement !== targetEl) {
                targetEl.appendChild(bubble);
              }
              bubble.style.left = pos.leftPct + '%';
              bubble.style.top = pos.topPct + '%';
              bubble.style.transform = 'translate(-50%, -50%)';
              bubble.style.display = 'flex';
              const section = document.querySelector('.multioi-quadrant-section');
              const wrapEl = document.getElementById('multioiQuadrantWrap');
              if (!section || !wrapEl) continue;
              const wrapOffsetX = wrapEl.offsetLeft;
              const wrapOffsetY = wrapEl.offsetTop;
              const bubblePxLeft = wrapOffsetX + wrapEl.offsetWidth * pos.leftPct / 100;
              const bubblePxTop = wrapOffsetY + wrapEl.offsetHeight * pos.topPct / 100;
              let overlayTip = document.getElementById('qOverlayTip_' + tfKey);
              if (!overlayTip && tooltipLayer) {
                overlayTip = document.createElement('span');
                overlayTip.className = 'bubble-tooltip';
                overlayTip.id = 'qOverlayTip_' + tfKey;
                overlayTip.style.opacity = '0';
                overlayTip.style.pointerEvents = 'none';
                tooltipLayer.appendChild(overlayTip);
                bubble.addEventListener('mouseenter', () => {
                  overlayTip.style.opacity = '1';
                  overlayTip.style.pointerEvents = 'auto';
                  overlayTip.style.transform = 'translateX(-50%) translateY(0)';
                });
                bubble.addEventListener('mouseleave', () => {
                  overlayTip.style.opacity = '0';
                  overlayTip.style.pointerEvents = 'none';
                  overlayTip.style.transform = 'translateX(-50%) translateY(4px)';
                });
                bubble.addEventListener('focus', () => {
                  overlayTip.style.opacity = '1';
                  overlayTip.style.pointerEvents = 'auto';
                  overlayTip.style.transform = 'translateX(-50%) translateY(0)';
                });
                bubble.addEventListener('blur', () => {
                  overlayTip.style.opacity = '0';
                  overlayTip.style.pointerEvents = 'none';
                  overlayTip.style.transform = 'translateX(-50%) translateY(4px)';
                });
              }
              if (overlayTip && sc) {
                const scDef = MF_SCENARIOS[scenarioIdx] || MF_SCENARIOS[0];
                const zP = Number.isFinite(sc.zPrice) ? (sc.zPrice >= 0 ? '+' : '') + sc.zPrice.toFixed(2) : '--';
                const zO = Number.isFinite(sc.zOi) ? (sc.zOi >= 0 ? '+' : '') + sc.zOi.toFixed(2) : '--';
                overlayTip.innerHTML = '<b style="color:' + scDef.color + '">' + tfKey + ': ' + scDef.name +
                  '<\/b><br>' + '<span style="color:#6EA8FE">Z_P:<\/span> ' + zP +
                  ' | <span style="color:#F3A052">Z_OI:<\/span> ' + zO;
                overlayTip.style.position = 'absolute';
                overlayTip.style.left = bubblePxLeft + 'px';
                if (pos.topPct < 40) {
                  overlayTip.style.top = (bubblePxTop + 28) + 'px';
                  overlayTip.style.bottom = 'auto';
                  overlayTip.style.transform = 'translateX(-50%) translateY(0)';
                } else {
                  overlayTip.style.top = (bubblePxTop - 42) + 'px';
                  overlayTip.style.bottom = 'auto';
                  overlayTip.style.transform = 'translateX(-50%) translateY(0)';
                }
                const tipHalfWidth = 75;
                const clampedLeft = Math.max(tipHalfWidth + 4, Math.min(bubblePxLeft, section.offsetWidth -
                  tipHalfWidth - 4));
                overlayTip.style.left = clampedLeft + 'px';
                overlayTip.style.display = '';
              }
              if (!bubble._kbNavAdded) {
                bubble._kbNavAdded = true;
                bubble.addEventListener('keydown', (e) => {
                  const tfOrder = ['30m', '1H', '4H'];
                  const curIdx = tfOrder.indexOf(tfKey);
                  let nextIdx = -1;
                  if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
                    nextIdx = (curIdx + 1) % tfOrder.length;
                  } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
                    nextIdx = (curIdx - 1 + tfOrder.length) % tfOrder.length;
                  } else if (e.key === 'Enter' || e.key === ' ') {
                    const tip = document.getElementById('qOverlayTip_' + tfKey);
                    if (tip) {
                      tip.style.opacity = '1';
                      tip.style.pointerEvents = 'auto';
                    }
                    e.preventDefault();
                    return;
                  }
                  if (nextIdx >= 0) {
                    e.preventDefault();
                    const nextBubble = document.getElementById('qBubble_' + tfOrder[nextIdx]);
                    if (nextBubble && nextBubble.style.display !== 'none') nextBubble.focus();
                  }
                });
              }
            }
          },
          renderSignalRemark() {
            const phraseEl = document.getElementById('multioiSignalRemark');
            if (!phraseEl) return;
            if (!this.classification || !this.classification.scenarios) {
              phraseEl.textContent = 'Awaiting data...';
              return;
            }
            const sym = (this.symbol || state.symbol || '').replace('USDT', '');
            const scenarios = this.classification.scenarios;
            const score = this.classification.signalStrength || 0;
            const tfSignals = [];
            for (const tf of MF_TIMEFRAMES) {
              const sc = scenarios[tf.key];
              if (!sc) {
                tfSignals.push({
                  tf: tf.key,
                  idx: 0,
                  name: 'Neutral',
                  color: '#6B7280'
                });
                continue;
              }
              const scDef = MF_SCENARIOS[sc.idx] || MF_SCENARIOS[0];
              tfSignals.push({
                tf: tf.key,
                idx: sc.idx,
                name: scDef.name,
                color: scDef.color
              });
            }
            const scenarioGroups = {};
            for (const s of tfSignals) {
              if (s.idx > 0) {
                if (!scenarioGroups[s.idx]) scenarioGroups[s.idx] = {
                  name: s.name,
                  color: s.color,
                  tfs: []
                };
                scenarioGroups[s.idx].tfs.push(s.tf);
              }
            }
            const distinctScenarioCount = Object.keys(scenarioGroups).length;
            const mixedType = distinctScenarioCount > 1 ? this._getMixedSubType(scenarioGroups) : null;
            let phrase = '';
            let scenarioColor = 'var(--text)';
            if (distinctScenarioCount === 0) {
              phrase = '<span class="signal-sym">$' + sym +
                '<\/span> — <span class="signal-action">No clear direction<\/span> on any timeframe. Stay flat until conditions develop.';
              scenarioColor = '#6B7280';
            } else if (distinctScenarioCount === 1) {
              const group = Object.values(scenarioGroups)[0];
              const tfList = group.tfs.join(', ');
              const neutralTfs = tfSignals.filter(s => s.idx === 0).map(s => s.tf);
              if (group.tfs.length === 3) {
                phrase = '<span class="signal-sym">$' + sym +
                  '<\/span> — <span class="signal-scenario" style="color:' + group.color + '">' + group.name +
                  '<\/span> across all timeframes.';
              } else if (neutralTfs.length > 0) {
                phrase = '<span class="signal-sym">$' + sym +
                  '<\/span> — <span class="signal-scenario" style="color:' + group.color + '">' + group.name +
                  '<\/span> on <span class="signal-tf">' + tfList + '<\/span> (<span style="color:#6B7280">' + neutralTfs.join(', ') + ' Neutral<\/span>).';
              } else {
                phrase = '<span class="signal-sym">$' + sym +
                  '<\/span> — <span class="signal-scenario" style="color:' + group.color + '">' + group.name +
                  '<\/span> on <span class="signal-tf">' + tfList + '<\/span>.';
              }
              scenarioColor = group.color;
            } else {
              const parts = tfSignals.filter(s => s.idx > 0).map(s => '<span style="color:' + s.color +
                ';font-weight:700">' + s.name + '<\/span><span class="signal-tf">' + s.tf + '<\/span>');
              const neutralParts = tfSignals.filter(s => s.idx === 0).map(s =>
                '<span style="color:#6B7280">Neutral<\/span><span class="signal-tf">' + s.tf + '<\/span>');
              const allParts = [...parts, ...neutralParts].join(' / ');
              if (mixedType === 'conflicting') {
                phrase = '<span class="signal-sym">$' + sym +
                  '<\/span> — <span class="signal-action">Timeframes disagree:<\/span> ' + allParts + '.';
              } else if (mixedType === 'divergent') {
                phrase = '<span class="signal-sym">$' + sym +
                  '<\/span> — <span class="signal-action">Same price direction but OI diverges:<\/span> ' + allParts + '.';
              } else if (mixedType === 'fading') {
                phrase = '<span class="signal-sym">$' + sym +
                  '<\/span> — <span class="signal-action">Momentum is fading across timeframes:<\/span> ' + allParts +
                  '.';
              } else {
                // Safety fallback for any unclassified mixed combination
                phrase = '<span class="signal-sym">$' + sym +
                  '<\/span> — <span class="signal-action">Mixed signals:<\/span> ' + allParts + '.';
              }
              
              // Mixed-type color
              if (mixedType === 'conflicting' || mixedType === 'divergent' || mixedType === 'fading') {
                scenarioColor = MF_SCENARIOS[2].color;                            // Amber — mixed conviction
              } else {
                // 'transitional' — currently unreachable with 4 scenarios;
                // fallback to neutral if ever triggered
                scenarioColor = '#6B7280';
              }
            }
            // Append timing + funding context
            const timingCtx = this._getTimingContext(distinctScenarioCount, scenarioGroups, score, mixedType);
            if (timingCtx) phrase += ' <span style="opacity:0.8">' + timingCtx + '</span>';
            phraseEl.innerHTML = phrase;
            phraseEl.style.color = scenarioColor;
          },

          _getTimingContext(distinctScenarioCount, scenarioGroups, score, mixedType) {
            if (distinctScenarioCount === 0) {
              return '';
            }

            const hasSu = !!scenarioGroups[1];
            const hasWr = !!scenarioGroups[2];
            const hasSd = !!scenarioGroups[3];
            const hasEx = !!scenarioGroups[4];
            const isBullish = hasSu || hasWr;
            const isBearish = hasSd || hasEx;
            const classifiedTfCount = Object.values(scenarioGroups).reduce((sum, g) => sum + g.tfs.length, 0);

            let maxAbsZ = 0;
            for (const tf of MF_TIMEFRAMES) {
              const sc = this.classification && this.classification.scenarios ? this.classification.scenarios[tf.key] : null;
              if (sc && sc.idx > 0) {
                const zp = this.stats.zPrice[tf.key];
                const zo = this.stats.zOi[tf.key];
                maxAbsZ = Math.max(maxAbsZ,
                  Number.isFinite(zp) ? Math.abs(zp) : 0,
                  Number.isFinite(zo) ? Math.abs(zo) : 0);
              }
            }
            const isExtended = maxAbsZ > 3.5;

            // Funding rate (raw decimal → percentage)
            const frRaw = this.stats.realtimeFundingRate;
            const frPct = Number.isFinite(frRaw) ? frRaw * 100 : null;

            let timing = '';
            let fundingCtx = '';

            // ── CONFLICTING
            if (mixedType === 'conflicting') {

              const isBullVsExhaustion = hasEx && isBullish && !hasSd;
              if (isBullVsExhaustion) {
                timing = 'Momentum peaking \u2014 tighten stops.';
              } else {
                timing = 'TFs oppose \u2014 stay out.';
              }
              if (frPct !== null && Math.abs(frPct) > 0.2) {
                fundingCtx = ' Extreme funding \u2014 squeeze risk.';
              }
            }
            // ── FADING (SD + EX) ──
            else if (mixedType === 'fading') {
              timing = 'Momentum fading \u2014 tighten stops.';
              if (frPct !== null) {
                if (frPct < -0.1) {
                  fundingCtx = ' Elevated short funding \u2014 squeeze risk.';
                } else if (frPct > 0.1) {
                  fundingCtx = ' Positive funding in downtrend \u2014 trapped longs.';
                }
              }
            }
            // ── DIVERGENT (SU + WR) ──
            else if (mixedType === 'divergent') {
              timing = 'OI diverges \u2014 wait for confirmation.';
              if (frPct !== null) {
                if (frPct > 0.1) {
                  fundingCtx = ' Elevated funding \u2014 longs overpaying.';
                } else if (frPct < -0.03) {
                  fundingCtx = ' Negative funding in uptrend \u2014 short squeeze fuel.';
                }
              }
            }
            // ── TRANSITIONAL (safety fallback — currently unreachable with 4 scenario types) ──
            else if (mixedType === 'transitional') {
              timing = 'Signals transitional \u2014 wait for clarity.';
              if (frPct !== null && Math.abs(frPct) > 0.2) {
                fundingCtx = ' Extreme funding \u2014 squeeze risk.';
              }
            }
            // ── PURE EXHAUSTION (EX only, no SU/SD/WR — price↓+OI↓ unwinding)
            //   Reached when EX is the only non-neutral scenario.
            //   isBearish includes EX, so condition uses hasEx && !hasSd to isolate EX-only.
            else if (hasEx && !hasSu && !hasSd && !hasWr) {
              if (classifiedTfCount >= 2) {
                timing = isExtended
                  ? 'Overextended unwinding \u2014 prepare for reversal.'
                  : 'Broad unwinding \u2014 reversal likely.';
              } else {
                timing = isExtended
                  ? 'Overextended unwinding \u2014 prepare for reversal.'
                  : 'Unwinding \u2014 reversal risk.';
              }
              // Granular funding context — EX is bearish-side (price↓), same granularity as SD
              if (frPct !== null) {
                if (frPct < -0.2) {
                  fundingCtx = ' Extreme negative funding \u2014 shorts crowded, reversal risk.';
                } else if (frPct < -0.1) {
                  fundingCtx = ' Elevated short funding amid unwinding \u2014 squeeze risk.';
                } else if (frPct > 0.1) {
                  fundingCtx = ' Positive funding amid unwinding \u2014 trapped longs.';
                }
              }
            }
            // ── PURE WEAK RALLY (WR only, no SU/SD/EX) ──
            //   !isBearish covers both !hasSd && !hasEx (since isBearish = hasSd || hasEx)
            else if (hasWr && !hasSu && !isBearish) {
              if (isExtended) {
                timing = 'Overextended weak rally \u2014 avoid new longs.';
              } else if (classifiedTfCount >= 2) {
                timing = 'Weak conviction \u2014 avoid new longs.';
              } else {
                timing = 'Weak on one TF \u2014 no new longs.';
              }
              if (frPct !== null) {
                if (frPct > 0.1) {
                  fundingCtx = ' Elevated funding \u2014 longs overpaying.';
                } else if (frPct < -0.03) {
                  fundingCtx = ' Negative funding in rally \u2014 short squeeze fuel.';
                }
              }
            }
            // ── PURE BULLISH (SU only — SU+WR goes to divergent, SU+EX/SD to conflicting) ──
            //   !isBearish covers both !hasSd && !hasEx (since isBearish = hasSd || hasEx)
            else if (isBullish && !isBearish) {
              if (isExtended) {
                timing = 'Overextended \u2014 avoid new longs.';
              } else if (classifiedTfCount >= 3) {
                timing = 'Trend established \u2014 favorable entry.';
              } else if (classifiedTfCount === 2) {
                timing = 'Trend building \u2014 cautious entry.';
              } else {
                timing = 'Trend early \u2014 wait for confirmation.';
              }
              // Funding context for bullish
              if (frPct !== null) {
                if (frPct > 0.2) {
                  fundingCtx = ' Extreme positive funding \u2014 longs crowded, reversal risk.';
                } else if (frPct > 0.1) {
                  fundingCtx = ' Elevated funding \u2014 longs crowded.';
                } else if (frPct < -0.03) {
                  fundingCtx = ' Negative funding in uptrend \u2014 short squeeze fuel.';
                }
              }
            }
            // ── PURE BEARISH (SD only — SD+EX goes to fading, SD+WR/SU to conflicting) ──
            //   !hasEx ensures EX-only is handled by the EX branch above, not here.
            else if (hasSd && !isBullish && !hasEx) {
              if (isExtended) {
                timing = 'Overextended \u2014 avoid new shorts.';
              } else if (classifiedTfCount >= 3) {
                timing = 'Downtrend established \u2014 favorable short.';
              } else if (classifiedTfCount === 2) {
                timing = 'Downtrend building \u2014 cautious short.';
              } else {
                timing = 'Downtrend early \u2014 wait for confirmation.';
              }
              // Funding context for bearish
              if (frPct !== null) {
                if (frPct < -0.2) {
                  fundingCtx = ' Extreme negative funding \u2014 shorts crowded, reversal risk.';
                } else if (frPct < -0.1) {
                  fundingCtx = ' Elevated short funding \u2014 shorts crowded.';
                } else if (frPct > 0.03) {
                  fundingCtx = ' Positive funding in downtrend \u2014 long squeeze fuel.';
                }
              }
            }
            // ── SAFETY FALLBACK (should be unreachable — all combinations handled above) ──
            else {
              timing = 'Mixed signals \u2014 wait for clarity.';
              if (frPct !== null && Math.abs(frPct) > 0.2) {
                fundingCtx = ' Extreme funding \u2014 squeeze risk.';
              }
            }

            return timing + fundingCtx;
          },

          _getMixedSubType(scenarioGroups) {
            // Classify the nature of multi-scenario disagreement.
            // With the current 4 non-neutral scenarios (SU=1, WR=2, SD=3, EX=4),
            // every possible combination maps to one of: conflicting, fading, divergent.
            //   Pairs:   {1,2}→divergent, {1,3}→conflicting, {1,4}→conflicting,
            //            {2,3}→conflicting, {2,4}→conflicting, {3,4}→fading
            //   Triples: any with bull+bear→conflicting, any with bull+exhaust→conflicting
            //            {3,4,...}→fading (if no bull present)
            // The 'transitional' return below is a safety fallback for future scenario types
            // or unexpected combinations; it is currently unreachable.
            const dirs = Object.keys(scenarioGroups).map(idx => {
              const i = parseInt(idx);
              if (i === 1) return 'bull_su';   // Strong Uptrend: price↑ + OI↑
              if (i === 2) return 'bull_wr';   // Weak Rally: price↑ + OI↓
              if (i === 3) return 'bear';
              if (i === 4) return 'exhaust';
              return 'other';
            });
            const hasBullSu = dirs.includes('bull_su');
            const hasBullWr = dirs.includes('bull_wr');
            const hasBull = hasBullSu || hasBullWr;
            const hasBear = dirs.includes('bear');
            const hasExhaust = dirs.includes('exhaust');
            if (hasBull && hasBear) return 'conflicting';
            if (hasBull && hasExhaust) return 'conflicting';
            if (hasBear && hasExhaust) return 'fading';
            // SU + WR: same price direction (up), opposite OI direction — OI is diverging
            if (hasBullSu && hasBullWr) return 'divergent';
            // Safety fallback — currently unreachable with 4 scenario types
            return 'transitional';
          },
          _getDominantScenario(scenarioGroups) {
            // Priority ensures scenario importance (SU > SD > WR > EX) always overrides TF weight.
            // Uses TF_INT_WEIGHTS (same as composite score) for consistency.
            // Priority multiplier (100) is large enough that scenario rank dominates
            // over TF weight differences, while TF weight still breaks same-scenario ties.
            const SCENARIO_PRIORITY = {
              1: 4,
              3: 3,
              2: 2,
              4: 1
            };
            const TF_INT_WEIGHTS = { '30m': 30, '1H': 40, '4H': 30 };
            const PRIORITY_SCALE = 100;
            // Iterate in deterministic priority order: 1 (SU), 3 (SD), 2 (WR), 4 (EX)
            const priorityOrder = [1, 3, 2, 4];
            let best = 0,
              bestScore = -1;
            for (const idx of priorityOrder) {
              const group = scenarioGroups[idx];
              if (!group) continue;
              let weightSum = 0;
              for (const tf of group.tfs) {
                weightSum += (TF_INT_WEIGHTS[tf] || 0);
              }
              const score = (SCENARIO_PRIORITY[idx] || 0) * PRIORITY_SCALE + weightSum;
              // Strict > ensures first in priority order wins ties (same priority → higher TF weight wins)
              if (score > bestScore) {
                best = idx;
                bestScore = score;
              }
            }
            return best;
          },
          render(classification) {
            this.renderQuadrant();
            this.renderSignalRemark();
            this._lastComputeTime = Date.now();
            const compositeEl = document.getElementById('multioiCompositeSignal');
            if (compositeEl) {
              const score = classification.signalStrength || 0;
              const dirEl = document.getElementById('compositeDirection');
              const summaryEl = document.getElementById('compositeTfSummary');
              let dirWord, dirClass;
              const scenarioGroups = {};
              for (const tf of MF_TIMEFRAMES) {
                const sc = classification.scenarios[tf.key];
                if (sc && sc.idx > 0) {
                  if (!scenarioGroups[sc.idx]) scenarioGroups[sc.idx] = {
                    tfs: []
                  };
                  scenarioGroups[sc.idx].tfs.push(tf.key);
                }
              }
              const dominantIdx = Object.keys(scenarioGroups).length > 0 ? this._getDominantScenario(scenarioGroups) :
                0;
              const isExhaustionDominant = dominantIdx === 4;
              const classifiedCount = Object.keys(scenarioGroups).length;
              const mixedType = classifiedCount > 1 ? this._getMixedSubType(scenarioGroups) : null;
              if (mixedType === 'conflicting') {
                // Timeframes genuinely oppose each other — always show Mixed Signals
                // Use 'caution' (amber) to match signal remark color for mixed conviction
                dirWord = 'Mixed Signals';
                dirClass = 'caution';
              } else if (mixedType === 'fading') {
                // SD+EX: momentum is fading, not a clean bearish signal
                // Use 'caution' (amber) to match signal remark color for mixed conviction
                dirWord = 'Fading Momentum';
                dirClass = 'caution';
              } else if (isExhaustionDominant) {
                // EX dominant always implies score < 0 (EX contributes -30 per TF, no SU/SD/WR can be present)
                // Label strength matches score severity for perceptual consistency
                dirWord = score <= -30 ? 'Exhaustion Reversal' : 'Mild Exhaustion';
                dirClass = score <= -30 ? 'bearish' : 'slightly-bearish';
              } else if (score >= 30) {
                dirWord = 'Bullish Scenario';
                dirClass = 'bullish';
              } else if (score > 0) {
                dirWord = 'Slightly Bullish Scenario';
                dirClass = 'slightly-bullish';
              } else if (score === 0) {
                dirWord = 'No Clear Scenario';
                dirClass = 'flat';
              } else if (score > -30) {
                dirWord = 'Slightly Bearish Scenario';
                dirClass = 'slightly-bearish';
              } else {
                dirWord = 'Bearish Scenario';
                dirClass = 'bearish';
              }
              if (dirEl) {
                dirEl.textContent = dirWord;
                dirEl.className = 'composite-direction ' + dirClass;
              }
              const scoreValueEl = document.getElementById('compositeScoreValue');
              if (scoreValueEl) {
                const sign = score > 0 ? '+' : '';
                scoreValueEl.textContent = sign + score;
                // Score color always reflects the actual score direction, independent of direction label
                let scoreClass;
                if (score >= 30) scoreClass = 'bullish';
                else if (score > 0) scoreClass = 'slightly-bullish';
                else if (score === 0) scoreClass = 'flat';
                else if (score > -30) scoreClass = 'slightly-bearish';
                else scoreClass = 'bearish';
                scoreValueEl.className = 'composite-score-value ' + scoreClass;
              }
              if (summaryEl) {
                const tfSummaryParts = [];
                const dirSymbols = {
                  1: '\u2191',
                  2: '\u2191',
                  3: '\u2193',
                  4: '\u26A0',
                  0: ''
                };
                for (const tf of MF_TIMEFRAMES) {
                  const sc = classification.scenarios[tf.key];
                  const idx = sc ? sc.idx : 0;
                  const scDef = MF_SCENARIOS[idx] || MF_SCENARIOS[0];
                  const symbol = dirSymbols[idx] ?? '';
                  const isColdStart = sc && sc.coldStart;
                  const scClass = {
                    1: 'scenario-su',
                    2: 'scenario-wr',
                    3: 'scenario-sd',
                    4: 'scenario-ex',
                    0: 'scenario-neutral'
                  } [idx] || 'scenario-neutral';
                  const coldStartClass = isColdStart ? ' scenario-coldstart' : '';
                  const displayName = isColdStart ? 'Warming' : scDef.name;
                  tfSummaryParts.push('<div class="composite-tf-item"><span class="tf-label">' + tf.key +
                    ': <\/span><span class="tf-scenario ' + scClass + coldStartClass + '">' + displayName + '<\/span> ' + symbol +
                    '<\/div>');
                }
                summaryEl.innerHTML = tfSummaryParts.join('');
                let copyBtn = document.getElementById('compositeCopyBtn');
                const wrapperEl = compositeEl.querySelector('.composite-content-wrapper');
                if (copyBtn) copyBtn.remove();
                copyBtn = document.createElement('button');
                copyBtn.className = 'composite-copy-btn';
                copyBtn.id = 'compositeCopyBtn';
                copyBtn.type = 'button';
                copyBtn.title = 'Copy signal summary';
                copyBtn.textContent = '\u29C9';
                copyBtn.addEventListener('click', () => {
                  const dirEl = document.getElementById('compositeDirection');
                  const scoreValueEl = document.getElementById('compositeScoreValue');
                  if (!dirEl || !scoreValueEl) return;
                  const dirText = dirEl.textContent.trim();
                  const scoreText = 'Composite Score: ' + scoreValueEl.textContent.trim();
                  const tickerName = (this.symbol || state.symbol || '').replace('USDT', '');
                  const dirSymbols = {
                    1: '\u2191',
                    2: '\u2191',
                    3: '\u2193',
                    4: '\u26A0',
                    0: ''
                  };
                  const summaryParts = [];
                  for (const tf of MF_TIMEFRAMES) {
                    const sc = this.classification && this.classification.scenarios[tf.key];
                    const idx = sc ? sc.idx : 0;
                    const scDef = MF_SCENARIOS[idx] || MF_SCENARIOS[0];
                    const sym = dirSymbols[idx] ?? '';
                    summaryParts.push(tf.key + ': ' + scDef.name + (sym ? ' ' + sym : ''));
                  }
                  const summaryText = summaryParts.join('\n');
                  const text = '$' + tickerName + ' - ' + dirText + '\n\n' + scoreText + '\n\n' + summaryText +
                    '\n\nFor OI signals, try: www.MultiPerps.com\n\nFree | No signup\n\n#MultiPerps #BinanceFutures';
                  copyText(text).then((ok) => {
                    if (ok) {
                      copyBtn.textContent = '\u2713';
                      copyBtn.classList.add('copied');
                    } else {
                      copyBtn.textContent = '\u2717';
                    }
                    setTimeout(() => {
                      copyBtn.textContent = '\u29C9';
                      copyBtn.classList.remove('copied');
                    }, 2000);
                  });
                });
                if (wrapperEl) {
                  const scoreRow = wrapperEl.querySelector('.composite-score-row');
                  if (scoreRow && scoreRow.nextSibling) {
                    wrapperEl.insertBefore(copyBtn, scoreRow.nextSibling);
                  } else {
                    wrapperEl.appendChild(copyBtn);
                  }
                }
              }
            }
            const warnEl = document.getElementById('oiPriceWarning');
            if (warnEl) {
              const warnings = [];
              if (this.stats.oiDataStale) warnings.push('OI data missing or stale');
              if (this.stats.klinesStale) warnings.push('Price kline data incomplete');
              if (this._lastComputeTime > 0 && Date.now() - this._lastComputeTime > 60000) {
                warnings.push('Composite score stale — awaiting REST refresh');
              }
              if (warnings.length > 0) {
                warnEl.innerHTML = '&#x26A0; ' + warnings.join(' | ');
                warnEl.style.display = 'flex';
              } else {
                warnEl.style.display = 'none';
              }
            }
            const discEl = document.getElementById('oiPriceDisclaimer');
            if (discEl) {
              const hasAnyScenario = Object.values(classification.scenarios).some(sc => sc && sc.idx > 0);
              discEl.style.display = hasAnyScenario ? 'block' : 'none';
            }
            this._backfillCompositeHistory();
            this.renderCompositeSparkline();
            this.renderPriceSparkline();
            this.renderZPriceSparkline();
            this.renderOiSparkline();
            this.renderContextRow();
          },
          renderContextRow() {
            const ctxEl = document.getElementById('oiPriceContext');
            if (!ctxEl) return;
            const items = [];
            if (Number.isFinite(this.stats.oiCurrent)) {
              const oi = this.stats.oiCurrent;
              const currentPrice = state.currentPrice;
              const oiNotional = Number.isFinite(currentPrice) ? oi * currentPrice : null;
              let oiStr, oiLabel;
              if (oiNotional !== null) {
                oiLabel = 'OI Notional:';
                if (oiNotional >= 1e9) oiStr = '$' + (oiNotional / 1e9).toFixed(2) + 'B';
                else if (oiNotional >= 1e6) oiStr = '$' + (oiNotional / 1e6).toFixed(2) + 'M';
                else if (oiNotional >= 1e3) oiStr = '$' + (oiNotional / 1e3).toFixed(1) + 'K';
                else oiStr = '$' + oiNotional.toFixed(2);
              } else {
                oiLabel = 'OI:';
                if (oi >= 1e9) oiStr = (oi / 1e9).toFixed(2) + 'B';
                else if (oi >= 1e6) oiStr = (oi / 1e6).toFixed(2) + 'M';
                else if (oi >= 1e3) oiStr = (oi / 1e3).toFixed(1) + 'K';
                else oiStr = oi.toFixed(2);
              }
              items.push('<span class="multioi-context-item"><span class="label">' + oiLabel +
                '<\/span><span class="value" style="color:var(--warn);font-weight:700">' + oiStr +
                '<\/span><\/span>');
            }
            // Prefer real-time funding rate; fall back to last settled rate
            const displayFr = Number.isFinite(this.stats.realtimeFundingRate)
              ? this.stats.realtimeFundingRate
              : this.stats.fundingRate;
            if (Number.isFinite(displayFr)) {
              const fr = displayFr;
              const frPct = (fr * 100).toFixed(6);
              const sign = fr > 0 ? '+' : '';
              let frColor = 'var(--text)';
              if (fr > 0.001) frColor = '#26D4AC';
              else if (fr > 0.0003) frColor = 'var(--warn)';
              else if (fr < -0.001) frColor = '#F23645';
              else if (fr < -0.0003) frColor = '#5B8CFF';
              let frHtml = '<span class="multioi-context-item"><span class="label">Funding:<\/span><span class="value" style="color:' +
                frColor + ';font-weight:700">' + sign + frPct + '%<\/span><\/span>';
              items.push(frHtml);
            }
            if (items.length >= 2) {
              items.splice(1, 0, '<br>');
            }
            ctxEl.innerHTML = items.join(' <span style="color:var(--muted-3);font-weight:300">|<\/span> ');
            ctxEl.innerHTML = ctxEl.innerHTML.replace(/<span[^>]*>\|<\/span>\s*<br>/g, '<br>');
            ctxEl.innerHTML = ctxEl.innerHTML.replace(/<br>\s*<span[^>]*>\|<\/span>/g, '<br>');
            ctxEl.style.display = items.length > 0 ? 'block' : 'none';
          },
          async refresh(symbol) {
            if (!symbol) return;
            this.symbol = symbol;
            try {
              const result = await this.fetchData(symbol);
              // If fetchData returned early (deferred), skip rendering with stale data
              if (result === false) return;
              const classification = this.computeClassification();
              this.render(classification);
            } catch (e) {
              console.warn('MultiOI: refresh error', e);
            }
          },
          startAutoRefresh(symbol) {
            this.stopAutoRefresh();
            const prevSymbol = this.symbol;
            this.symbol = symbol;
            // If symbol changed, clear stale data immediately so that render calls
            // during the async fetchData() don't draw the old symbol's sparklines.
            // (fetchData() has its own check, but it compares this.symbol === symbol
            // which is now true because we just set it above, so it would skip clearing.)
            if (prevSymbol !== symbol) {
              this.tfData = {};
              this._backfillCache = null;
              this._backfillZPriceCache = null;
              this._backfillZOiCache = null;
              this._backfillLast1hTs = null;
              this._backfillCacheTime = null;
              this._zPrice1hHistory = [];
              this._zOi1hHistory = [];
              this._scoreHistory = [];
              this.classification = { scenarios: {}, signalStrength: 0 };
            }
            this.refresh(symbol);
            this.timer = setInterval(() => {
              if (this.symbol && state.isRunning) {
                this.refresh(this.symbol);
              }
            }, 30000);
            this._slowTimer = setInterval(() => {
              if (this.symbol && state.isRunning) {
                this._refreshSlowData(this.symbol);
              }
            }, 60000);
          },
          stopAutoRefresh() {
            if (this.timer) {
              clearInterval(this.timer);
              this.timer = null;
            }
            if (this._slowTimer) {
              clearInterval(this._slowTimer);
              this._slowTimer = null;
            }
            if (this._wsSparklineTimer) {
              clearTimeout(this._wsSparklineTimer);
              this._wsSparklineTimer = null;
            }
            if (this._wsRemarkTimer) {
              clearTimeout(this._wsRemarkTimer);
              this._wsRemarkTimer = null;
            }
            this._isRefreshing = false;
          },

          renderCompositeSparkline() {
            const canvas = document.getElementById('compositeSparklineCanvas');
            if (!canvas) return;
            // Score history is now managed by _backfillCompositeHistory() — just render it
            const history = this._scoreHistory;
            try {
              const key = 'mf_scoreHistory_' + (this.symbol || '');
              localStorage.setItem(key, JSON.stringify(history));
            } catch (e) {}
            // History is provided to _initSparklineHover() via getHistory() closure — no canvas property needed
            this._drawSparkline(canvas, history, {
              zeroLine: true,
              fillPositive: '#26D4AC',
              fillNegative: '#F23645',
              linePositive: '#26D4AC',
              lineNegative: '#F23645',
            });
            const lastVal = history.length > 0 ? history[history.length - 1] : NaN;
            const lastEl = document.getElementById('compositeLastVal');
            if (lastEl && Number.isFinite(lastVal)) lastEl.textContent = (lastVal >= 0 ? '+' : '') + lastVal.toFixed(
              0);
          },
          renderPriceSparkline() {
            const canvas = document.getElementById('priceSparklineCanvas');
            if (!canvas) return;
            const d = this.tfData['1H'];
            const priceHistory = (d && d.closes) ? d.closes.slice(-MF_SPARKLINE_POINTS) : [];
            const lastPrice = priceHistory.length > 0 ? priceHistory[priceHistory.length - 1] : NaN;
            const firstPrice = priceHistory.length > 0 ? priceHistory[0] : NaN;
            const lineColor = '#B8C4D4';
            // History is provided to _initSparklineHover() via getHistory() closure — no canvas property needed
            this._drawSparkline(canvas, priceHistory, {
              zeroLine: false,
              fillPositive: lineColor,
              fillNegative: lineColor,
              linePositive: lineColor,
              lineNegative: lineColor,
              fillBaseline: 'bottom',
            });
            const lastEl = document.getElementById('priceLastVal');
            if (lastEl && Number.isFinite(lastPrice)) lastEl.textContent = '$' + lastPrice.toLocaleString('en-US', {
              minimumFractionDigits: 2,
              maximumFractionDigits: 8
            });
          },
          renderZPriceSparkline() {
            const canvas = document.getElementById('zPriceSparklineCanvas');
            if (!canvas) return;
            // Pass raw history including NaN — _drawSparkline handles NaN gaps for uniform X-axis spacing
            const history = this._zPrice1hHistory;
            // Blue (#5B8CFF) when up, red (#F23645) when down — uses finite values for up/down detection
            const finiteVals = history.filter(v => Number.isFinite(v));
            const lastVal = finiteVals.length > 0 ? finiteVals[finiteVals.length - 1] : NaN;
            const firstVal = finiteVals.length > 0 ? finiteVals[0] : NaN;
            const up = Number.isFinite(lastVal) && Number.isFinite(firstVal) && lastVal >= firstVal;
            const lineColor = up ? '#5B8CFF' : '#F23645';
            this._drawSparkline(canvas, history, {
              zeroLine: true,
              fillPositive: lineColor,
              fillNegative: lineColor,
              linePositive: lineColor,
              lineNegative: lineColor,
            });
            const lastEl = document.getElementById('zPriceLastVal');
            if (lastEl && Number.isFinite(lastVal)) lastEl.textContent = (lastVal >= 0 ? '+' : '') + lastVal.toFixed(2);
          },
          renderOiSparkline() {
            const canvas = document.getElementById('zOiSparklineCanvas');
            if (!canvas) return;
            // Pass raw history including NaN — _drawSparkline handles NaN gaps for uniform X-axis spacing
            const history = this._zOi1hHistory;
            // Amber / orange — same as Z_OI tooltip colour #F3A052
            const lineColor = '#F3A052';
            this._drawSparkline(canvas, history, {
              zeroLine: true,
              fillPositive: lineColor,
              fillNegative: lineColor,
              linePositive: lineColor,
              lineNegative: lineColor,
            });
            const finiteVals = history.filter(v => Number.isFinite(v));
            const lastVal = finiteVals.length > 0 ? finiteVals[finiteVals.length - 1] : NaN;
            const lastEl = document.getElementById('zOiLastVal');
            if (lastEl && Number.isFinite(lastVal)) lastEl.textContent = (lastVal >= 0 ? '+' : '') + lastVal.toFixed(2);
          },
          _drawSparkline(canvas, history, opts) {
            const dpr = window.devicePixelRatio || 1;
            const rect = canvas.getBoundingClientRect();
            if (rect.width === 0 || rect.height === 0) return;
            canvas.width = Math.floor(rect.width * dpr);
            canvas.height = Math.floor(rect.height * dpr);
            const ctx = canvas.getContext('2d');
            ctx.scale(dpr, dpr);
            const W = rect.width;
            const H = rect.height;
            // Build list of finite-indexed points (handles NaN gracefully)
            const finitePoints = [];
            for (let i = 0; i < history.length; i++) {
              if (Number.isFinite(history[i])) finitePoints.push({ i, v: history[i] });
            }
            // Fallback: draw placeholder when insufficient finite data
            if (finitePoints.length < 2) {
              ctx.fillStyle = 'rgba(123, 135, 148, 0.4)';
              ctx.font = '11px monospace';
              ctx.textAlign = 'center';
              ctx.textBaseline = 'middle';
              ctx.fillText('Awaiting data\u2026', W / 2, H / 2);
              return;
            }
            let min = Math.min(...finitePoints.map(p => p.v));
            let max = Math.max(...finitePoints.map(p => p.v));
            if (opts.zeroLine) {
              min = Math.min(min, 0);
              max = Math.max(max, 0);
            }
            const range = max - min || 1;
            const pad = range * 0.15;
            min -= pad;
            max += pad;
            // Use raw history length for x-positioning to preserve temporal positions
            const rawLen = history.length;
            const toX = (i) => (i / (rawLen - 1)) * W;
            const toY = (v) => H * (1 - (v - min) / (max - min));
            if (opts.zeroLine) {
              ctx.strokeStyle = 'rgba(255,255,255,0.1)';
              ctx.lineWidth = 0.5;
              ctx.beginPath();
              ctx.moveTo(0, toY(0));
              ctx.lineTo(W, toY(0));
              ctx.stroke();
            }
            const lastFiniteVal = finitePoints[finitePoints.length - 1].v;
            const isPositive = lastFiniteVal >= 0;
            const fillColor = isPositive ? opts.fillPositive : opts.fillNegative;
            const lineColor = isPositive ? opts.linePositive : opts.lineNegative;
            const baseline = opts.fillBaseline === 'bottom' ? H : toY(0);
            // Draw fill area — break at NaN (each contiguous segment gets its own fill)
            const fillGrad = ctx.createLinearGradient(0, 0, 0, baseline);
            fillGrad.addColorStop(0, fillColor + '30');
            fillGrad.addColorStop(0.5, fillColor + '18');
            fillGrad.addColorStop(1, fillColor + '00');
            ctx.fillStyle = fillGrad;
            let segStart = -1;
            for (let i = 0; i <= rawLen; i++) {
              const isFinite = i < rawLen && Number.isFinite(history[i]);
              if (isFinite && segStart < 0) {
                segStart = i;
              } else if (!isFinite && segStart >= 0) {
                // Draw fill for segment [segStart..i-1]
                ctx.beginPath();
                ctx.moveTo(toX(segStart), baseline);
                for (let j = segStart; j < i; j++) {
                  ctx.lineTo(toX(j), toY(history[j]));
                }
                ctx.lineTo(toX(i - 1), baseline);
                ctx.closePath();
                ctx.fill();
                segStart = -1;
              }
            }
            // Draw line — break at NaN (moveTo after gap, lineTo when contiguous)
            ctx.strokeStyle = lineColor;
            ctx.lineWidth = opts.lineWidth || 1.5;
            ctx.lineJoin = 'round';
            ctx.beginPath();
            let penDown = false;
            for (let i = 0; i < rawLen; i++) {
              if (!Number.isFinite(history[i])) {
                penDown = false;
                continue;
              }
              const x = toX(i);
              const y = toY(history[i]);
              if (!penDown) { ctx.moveTo(x, y); penDown = true; }
              else ctx.lineTo(x, y);
            }
            ctx.stroke();
            // Draw small dots at each finite data point (except last)
            for (const p of finitePoints) {
              if (p.i === finitePoints[finitePoints.length - 1].i) continue;
              ctx.fillStyle = lineColor + '99';
              ctx.beginPath();
              ctx.arc(toX(p.i), toY(p.v), 2, 0, Math.PI * 2);
              ctx.fill();
            }
            // Draw highlighted dot at last finite point
            const lastFP = finitePoints[finitePoints.length - 1];
            ctx.save();
            ctx.shadowColor = lineColor;
            ctx.shadowBlur = 8;
            ctx.fillStyle = lineColor;
            ctx.beginPath();
            ctx.arc(toX(lastFP.i), toY(lastFP.v), 3, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
            ctx.fillStyle = '#ffffff';
            ctx.beginPath();
            ctx.arc(toX(lastFP.i), toY(lastFP.v), 1.2, 0, Math.PI * 2);
            ctx.fill();
          },
          async _refreshSlowData(symbol) {
            try {
              // Fetch latest settled funding rate from history endpoint
              const frHistRes = await fetchJsonWithTimeout(
                `https://fapi.binance.com/fapi/v1/fundingRate?symbol=${encodeURIComponent(symbol)}&limit=3`);
              if (frHistRes && Array.isArray(frHistRes) && frHistRes.length >= 2) {
                const settledFr = parseFloat(frHistRes[frHistRes.length - 2].fundingRate);
                if (Number.isFinite(settledFr)) {
                  this.stats.fundingRate = settledFr;
                }
              }
              // Update real-time funding rate from premiumIndex
              const fundingRes = await fetchJsonWithTimeout(
                `https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${encodeURIComponent(symbol)}`);
              if (fundingRes && fundingRes.lastFundingRate !== undefined) {
                const rtFr = parseFloat(fundingRes.lastFundingRate);
                if (Number.isFinite(rtFr)) this.stats.realtimeFundingRate = rtFr;
              }
            } catch (e) {
              console.warn('MultiOI: slow data refresh error', e);
            }
          },
          init() {
            // Prune stale score history from localStorage for symbols not currently in use
            try {
              const currentSymbol = this.symbol || '';
              const keysToRemove = [];
              for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key && key.startsWith('mf_scoreHistory_') && key !== 'mf_scoreHistory_' + currentSymbol) {
                  // Collect all non-current symbol histories for pruning
                  keysToRemove.push(key);
                }
              }
              // Keep at most 5 symbol histories beyond the current one
              if (keysToRemove.length > 5) {
                keysToRemove.slice(5).forEach(k => {
                  try { localStorage.removeItem(k); } catch (e) {}
                });
              }
            } catch (e) {}
            const infoBtn = document.querySelector('.multioi-info-btn');
            const tooltipPopup = document.querySelector('.multioi-tooltip-popup');
            if (infoBtn && tooltipPopup) {
              document.body.appendChild(tooltipPopup);
              infoBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const isActive = tooltipPopup.classList.toggle('active');
                if (isActive) {
                  const btnRect = infoBtn.getBoundingClientRect();
                  const popupWidth = Math.min(460, window.innerWidth - 20);
                  tooltipPopup.style.width = popupWidth + 'px';
                  const navHeight = 52;
                  let top = btnRect.bottom + 8;
                  let left = btnRect.left;
                  if (left + popupWidth > window.innerWidth - 10) {
                    left = window.innerWidth - popupWidth - 10;
                  }
                  if (top < navHeight) top = navHeight + 4;
                  const maxH = Math.min(window.innerHeight * 0.85, 640);
                  if (top + maxH > window.innerHeight) {
                    top = Math.max(navHeight + 4, btnRect.top - maxH - 8);
                  }
                  tooltipPopup.style.top = top + 'px';
                  tooltipPopup.style.left = left + 'px';
                }
              });
              tooltipPopup.addEventListener('click', (e) => {
                e.stopPropagation();
              });
              document.addEventListener('click', () => {
                tooltipPopup.classList.remove('active');
              });
            }
            const copyBtn = document.getElementById('oiCopyBtn');
            if (copyBtn) {
              copyBtn.addEventListener('click', async () => {
                try {
                  copyBtn.textContent = '⏳';
                  copyBtn.disabled = true;
                  const panel = document.getElementById('oiPricePanel');
                  if (!panel) throw new Error('Panel not found');
                  const favSection = panel.querySelector('.fav-tickers-section');
                  if (favSection) favSection.style.display = 'none';
                  const shareCopyChartBtnEl = document.getElementById('shareCopyChartBtn');
                  const shareModalEl = document.getElementById('shareModal');
                  if (shareModalEl) shareModalEl.style.display = 'none';
                  copyBtn.style.display = 'none';
                  if (typeof html2canvas !== 'function') {
                    await new Promise((resolve, reject) => {
                      const script = document.createElement('script');
                      script.src =
                        'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
                      script.onload = resolve;
                      script.onerror = () => reject(new Error('Failed to load html2canvas'));
                      document.head.appendChild(script);
                    });
                  }
                  if (typeof html2canvas !== 'function') {
                    throw new Error('html2canvas failed to load');
                  }
                  const canvas = await html2canvas(panel, {
                    backgroundColor: '#0A0E14',
                    scale: 2,
                    logging: false,
                    useCORS: true,
                    allowTaint: true,
                  });
                  if (favSection) favSection.style.display = '';
                  if (shareModalEl) shareModalEl.style.display = '';
                  copyBtn.style.display = '';
                  const tickerName = (this.symbol || '').replace('USDT', '');
                  const textFontSize = 24;
                  const textPadding = 20;
                  const textLineHeight = textFontSize * 1.4;
                  const textBlockHeight = textLineHeight + textPadding * 2;
                  const compositeCanvas = document.createElement('canvas');
                  compositeCanvas.width = canvas.width;
                  compositeCanvas.height = canvas.height + textBlockHeight;
                  const ctx = compositeCanvas.getContext('2d');
                  ctx.fillStyle = '#0A0E14';
                  ctx.fillRect(0, 0, compositeCanvas.width, compositeCanvas.height);
                  ctx.drawImage(canvas, 0, 0);
                  const textFont = `600 ${textFontSize}px 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif`;
                  ctx.font = textFont;
                  ctx.textAlign = 'center';
                  const parts = [{
                    text: 'www.MultiPerps.com  ',
                    color: '#CDD7E1'
                  }, {
                    text: '#MultiPerps  ',
                    color: '#22AB94'
                  }, {
                    text: '#' + tickerName,
                    color: '#F3A052'
                  }, ];
                  const totalW = parts.reduce((s, p) => s + ctx.measureText(p.text).width, 0);
                  let x = (compositeCanvas.width - totalW) / 2;
                  const y = canvas.height + textPadding + textLineHeight;
                  ctx.textAlign = 'left';
                  for (const part of parts) {
                    ctx.fillStyle = part.color;
                    ctx.fillText(part.text, x, y);
                    x += ctx.measureText(part.text).width;
                  }
                  compositeCanvas.toBlob(async (blob) => {
                    if (!blob) throw new Error('Canvas toBlob failed');
                    try {
                      await navigator.clipboard.write([new ClipboardItem({
                        'image/png': blob
                      })]);
                      copyBtn.classList.add('copied');
                      copyBtn.textContent = '✓';
                    } catch {
                      try {
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = 'MultiOI-' + tickerName + '.png';
                        a.click();
                        URL.revokeObjectURL(url);
                        copyBtn.classList.add('copied');
                        copyBtn.textContent = '✓';
                      } catch {
                        copyBtn.textContent = '✗';
                      }
                    }
                    copyBtn.disabled = false;
                    setTimeout(() => {
                      copyBtn.textContent = '\u29C9';
                      copyBtn.classList.remove('copied');
                    }, 4000);
                  }, 'image/png');
                } catch (err) {
                  console.error('Multi OI capture failed:', err);
                  const _panel = document.getElementById('oiPricePanel');
                  const favSection2 = _panel ? _panel.querySelector('.fav-tickers-section') : null;
                  if (favSection2) favSection2.style.display = '';
                  const shareModalEl2 = document.getElementById('shareModal');
                  if (shareModalEl2) shareModalEl2.style.display = '';
                  copyBtn.style.display = '';
                  copyBtn.textContent = '✗';
                  copyBtn.disabled = false;
                  setTimeout(() => {
                    copyBtn.textContent = '\u29C9';
                    copyBtn.classList.remove('copied');
                  }, 2000);
                }
              });
            }
            const resizeCanvas = () => {
              if (this.classification && this.classification.scenarios) {
                this.renderQuadrant();
              }
            };
            window.addEventListener('resize', resizeCanvas);
            try {
              const hash = window.location.hash;
              if (hash && hash.startsWith('#/signal/')) {
                const parts = hash.replace('#/signal/', '').split('/');
                if (parts.length >= 1) {
                  const signalSym = decodeURIComponent(parts[0]);
                  const scrollToPanel = () => {
                    const panel = document.getElementById('oiPricePanel');
                    if (panel) panel.scrollIntoView({
                      behavior: 'smooth',
                      block: 'start'
                    });
                  };
                  setTimeout(scrollToPanel, 2000);
                }
              }
            } catch (e) {}
            this._initSparklineHover();
          },
          _initSparklineHover() {
            const sparklineMap = [{
              canvasId: 'compositeSparklineCanvas',
              valId: 'compositeHoverVal',
              getHistory: () => this._scoreHistory,
              // Composite score is already real-time — no last-point override
              realtimeValue: null,
              format: v => (v >= 0 ? '+' : '') + v.toFixed(0)
            }, {
              canvasId: 'priceSparklineCanvas',
              valId: 'priceHoverVal',
              getHistory: () => {
                const d = this.tfData['1H'];
                return d && d.closes ? d.closes.slice(-MF_SPARKLINE_POINTS) : [];
              },
              // Price last close is already the current candle — no override needed
              realtimeValue: null,
              format: v => '$' + v.toLocaleString('en-US', {
                minimumFractionDigits: 2,
                maximumFractionDigits: 8
              })
            }, {
              canvasId: 'zPriceSparklineCanvas',
              valId: 'zPriceHoverVal',
              getHistory: () => this._zPrice1hHistory,
              // Live Z_Price 1H is the last point — use stats for real-time override
              realtimeValue: () => this.stats.zPrice['1H'],
              format: v => 'Z_P ' + (v >= 0 ? '+' : '') + v.toFixed(2)
            }, {
              canvasId: 'zOiSparklineCanvas',
              valId: 'zOiHoverVal',
              getHistory: () => this._zOi1hHistory,
              // Live Z_OI 1H is the last point — use stats for real-time override
              realtimeValue: () => this.stats.zOi['1H'],
              format: v => 'Z_O ' + (v >= 0 ? '+' : '') + v.toFixed(2)
            }, ];
            for (const sm of sparklineMap) {
              const canvas = document.getElementById(sm.canvasId);
              if (!canvas) continue;
              canvas.addEventListener('mousemove', (e) => {
                const history = sm.getHistory();
                if (!history || history.length < 2) return;
                const rect = canvas.getBoundingClientRect();
                const x = e.clientX - rect.left;
                const idx = Math.round((x / rect.width) * (history.length - 1));
                const clampedIdx = Math.max(0, Math.min(history.length - 1, idx));
                // For the last point, use the real-time value if available
                let val = history[clampedIdx];
                if (clampedIdx === history.length - 1 && sm.realtimeValue) {
                  const rtv = typeof sm.realtimeValue === 'function' ? sm.realtimeValue() : sm.realtimeValue;
                  if (Number.isFinite(rtv)) val = rtv;
                }
                const valEl = document.getElementById(sm.valId);
                if (valEl && Number.isFinite(val)) {
                  valEl.textContent = sm.format(val);
                }
                canvas.closest('.multioi-sparkline-card')?.classList.add('hovering');
              });
              canvas.addEventListener('mouseleave', () => {
                const valEl = document.getElementById(sm.valId);
                if (valEl) valEl.textContent = '';
                canvas.closest('.multioi-sparkline-card')?.classList.remove('hovering');
              });
            }
          }
        };
        let _loadSymbolGeneration = 0;
        let _loadSymbolDebounceTimer = null;
        const loadSymbol = (raw) => {
          clearTimeout(_loadSymbolDebounceTimer);
          return new Promise((resolve) => {
            _loadSymbolDebounceTimer = setTimeout(async () => {
              await _loadSymbolImpl(raw);
              resolve();
            }, 250);
          });
        };
        const _loadSymbolImpl = async (raw) => {
          const gen = ++_loadSymbolGeneration;
          const next = normalizeSymbol(raw);
          if (!next) return;
          const wasRunning = state.isRunning;
          if (wasRunning) {
            if (state.chartTimer) {
              clearInterval(state.chartTimer);
              state.chartTimer = null;
            }
            if (state.healthTimer) {
              clearInterval(state.healthTimer);
              state.healthTimer = null;
            }
            closeWs();
          }
          state.symbol = next;
          if (state.urlSymbolMode) setUrlSymbol(next);
          else saveStored(STORAGE.symbol, next);
          state.currentPrice = null;
          state.lastTradeTime = null;
          state.lastMessageTime = null;
          state.msgsInWindow = 0;
          state.reconnectAttempts = 0;
          const titleEl = state.elements.tickerTitle;
          const displayText = next.replace('USDT', '');
          if (titleEl) {
            const textNodes = Array.from(titleEl.childNodes).filter(n => n.nodeType === Node.TEXT_NODE);
            if (textNodes.length > 0) {
              textNodes[textNodes.length - 1].textContent = displayText;
            } else {
              titleEl.appendChild(document.createTextNode(displayText));
            }
          }
          if (state.elements.compositeTickerTitle) {
            const favImg = document.getElementById('compositeTickerFavicon');
            if (favImg) {
              favImg.src = 'https://bin.bnbstatic.com/static/images/common/favicon.ico';
              favImg.alt = displayText;
              favImg.style.display = 'inline-block';
              favImg.onerror = function() {
                this.style.display = 'none';
              };
            }
            const oldTextNodes = [];
            state.elements.compositeTickerTitle.childNodes.forEach(n => {
              if (n.nodeType === 3) oldTextNodes.push(n);
            });
            oldTextNodes.forEach(n => n.remove());
            state.elements.compositeTickerTitle.appendChild(document.createTextNode(displayText));
          }
          if (state.elements.compositeTickerPrice) {
            state.elements.compositeTickerPrice.textContent = 'Loading...';
            state.elements.compositeTickerPrice.classList.remove('price-up', 'price-down');
          }
          const displaySym = next.replace('USDT', '');
          document.title =
            `${displaySym} Binance Futures Chart — Multi-Timeframe & Open Interest Price Analysis | MultiPerps`;
          try {
            const sym = next.replace('USDT', '');
            const fullSym = next;
            const base = window.location.origin;
            const tickerPath = '/' + fullSym;
            const titleTag =
              `${sym} Binance Futures Chart — Multi-Timeframe & Open Interest Price Analysis | MultiPerps`;
            const descTag =
              `${sym} Binance USDT-M perpetual futures live chart on MultiPerps. Real-time multi-timeframe candlestick charts (1m to 1M), Multi OI Open Interest Price analysis, price alerts, open interest & funding rate data. Free, No sign-up.`;
            document.title = titleTag;
            const metaDesc = document.getElementById('meta-description');
            if (metaDesc) metaDesc.setAttribute('content', descTag);
            const linkCanon = document.getElementById('link-canonical');
            if (linkCanon) linkCanon.setAttribute('href', base + tickerPath);
            const metaCanon = document.getElementById('meta-canonical');
            if (metaCanon) metaCanon.setAttribute('content', base + tickerPath);
            const ogUrl = document.getElementById('og-url');
            if (ogUrl) ogUrl.setAttribute('content', base + tickerPath);
            const ogTitle = document.getElementById('og-title');
            if (ogTitle) ogTitle.setAttribute('content', titleTag);
            const ogDesc = document.getElementById('og-description');
            if (ogDesc) ogDesc.setAttribute('content', descTag);
            const twTitle = document.getElementById('twitter-title');
            if (twTitle) twTitle.setAttribute('content', titleTag);
            const twDesc = document.getElementById('twitter-description');
            if (twDesc) twDesc.setAttribute('content', descTag);
            if (state.urlSymbolMode) {
              const newUrl = base + tickerPath;
              window.history.replaceState(null, '', newUrl);
            }
          } catch (e) {}
          if (state.elements.headerPrice) {
            state.elements.headerPrice.textContent = 'Loading...';
          }
          if (state.elements.compositeTickerPrice) {
            state.elements.compositeTickerPrice.textContent = 'Loading...';
            state.elements.compositeTickerPrice.classList.remove('price-up', 'price-down');
          }
          updatePriceUI();
          await fetchCurrentPrice(next);
          if (gen !== _loadSymbolGeneration) return;
          const priorityIntervals = ['5m', '15m', '1h'];
          const otherIntervals = CONFIG.INTERVALS.filter(i => !priorityIntervals.includes(i));
          await Promise.all(priorityIntervals.map(async (interval) => {
            const chart = state.charts[interval];
            try {
              chart.candles = await fetchExchangeKlines(next, interval, CONFIG.KLINE_LIMIT);
            } catch {
              chart.candles = [];
            }
            chart.dirty = true;
          }));
          updateChartMetas();
          redrawCharts();
          if (gen !== _loadSymbolGeneration) return;
          await Promise.all(otherIntervals.map(async (interval) => {
            const chart = state.charts[interval];
            try {
              chart.candles = await fetchExchangeKlines(next, interval, CONFIG.KLINE_LIMIT);
            } catch {
              chart.candles = [];
            }
            chart.dirty = true;
          }));
          updateChartMetas();
          redrawCharts();
          updateCountdowns();
          updateStatus();
          if (gen !== _loadSymbolGeneration) return;
          if (state.isRunning) {
            oiPricePanel.startAutoRefresh(next);
          }
          if (wasRunning) start();
        };
        const fetchRankingsData = async () => {
          try {
            const data = await fetchJsonWithTimeout('https://fapi.binance.com/fapi/v1/ticker/24hr');
            const list = Array.isArray(data) ? data : [];
            const items = [];
            for (const t of list) {
              const sym = String(t?.symbol || '').toUpperCase();
              if (!sym || !sym.endsWith('USDT')) continue;
              const lastPrice = Number.parseFloat(t?.lastPrice);
              const pct = Number.parseFloat(t?.priceChangePercent);
              const quoteVol = Number.parseFloat(t?.quoteVolume);
              const vol = Number.parseFloat(t?.volume);
              if (!Number.isFinite(lastPrice) || !Number.isFinite(quoteVol)) continue;
              items.push({
                symbol: sym,
                ticker: toDisplayTicker(sym),
                lastPrice,
                pct: Number.isFinite(pct) ? pct : 0,
                volUsdt: quoteVol,
                volume: Number.isFinite(vol) ? vol : 0,
              });
            }
            items.sort((a, b) => a.symbol.localeCompare(b.symbol));
            state.rankings.data = items;
            return items;
          } catch (err) {
            console.error('Rankings fetch error:', err);
            return state.rankings.data || [];
          }
        };
        const fetchOpenInterest = async (symbol) => {
          try {
            const data = await fetchJsonWithTimeout(
              `https://fapi.binance.com/fapi/v1/openInterest?symbol=${encodeURIComponent(symbol)}`);
            const oi = Number.parseFloat(data?.openInterest);
            return Number.isFinite(oi) ? oi : null;
          } catch {
            return null;
          }
        };
        const fetchOpenInterests = async (symbols) => {
          const results = [];
          for (let i = 0; i < symbols.length; i += CONFIG.OI_FETCH_BATCH_SIZE) {
            const batch = symbols.slice(i, i + CONFIG.OI_FETCH_BATCH_SIZE);
            const batchResults = await Promise.all(batch.map(async (sym) => {
              const oi = await fetchOpenInterest(sym);
              return {
                symbol: sym,
                oi
              };
            }));
            results.push(...batchResults);
            if (i + CONFIG.OI_FETCH_BATCH_SIZE < symbols.length) {
              await new Promise(r => setTimeout(r, CONFIG.OI_FETCH_DELAY_MS));
            }
          }
          return results;
        };
        const buildRankingTable = (items, columns) => {
          if (!items || items.length === 0) {
            return '<div class="ranking-error">No data available<\/div>';
          }
          let html = '<table class="ranking-table" role="table" aria-label="Ranking table">';
          html += '<thead><tr>';
          for (const col of columns) {
            html += `<th>${col.header}<\/th>`;
          }
          html += '<\/tr><\/thead><tbody>';
          for (let i = 0; i < items.length; i++) {
            const item = items[i];
            html += '<tr>';
            for (const col of columns) {
              const value = col.getValue(item, i);
              const className = col.getClass ? col.getClass(item) : '';
              html += `<td class="${className}">${value}<\/td>`;
            }
            html += '<\/tr>';
          }
          html += '<\/tbody><\/table>';
          return html;
        };
        const buildRankingFavStar = (ticker) => {
          const isFav = isFavoriteTicker(ticker);
          return `<button type="button" class="ranking-fav-star${isFav ? ' fav' : ''}" data-rank-fav="${ticker}" title="${isFav ? 'Remove from' : 'Add to'} favourites">${isFav ? '★' : '☆'}<\/button>`;
        };
        const buildRankingTradeLink = (symbol) => {
          const url = getBinanceFuturesUrl(symbol);
          return `<a href="${url}" target="_blank" rel="noopener noreferrer" class="ranking-trade-link" data-rank-trade="${symbol}" title="Trade on Binance">🔗<\/a>`;
        };
        const renderVolumeRanking = () => {
          const container = document.getElementById('volumeContent');
          const loading = document.getElementById('volumeLoading');
          if (!container) return;
          const items = state.rankings.data.slice().sort((a, b) => b.volUsdt - a.volUsdt).slice(0, CONFIG
            .RANKINGS_TOP_N);
          const columns = [{
            header: '#',
            getValue: (item, idx) => `<span class="rank-num">${idx + 1}<\/span>`
          }, {
            header: '★',
            getValue: (item) => buildRankingFavStar(item.ticker)
          }, {
            header: 'Symbol',
            getValue: (item) => `<span class="sym-name" data-sym="${item.symbol}">${item.ticker}<\/span>`,
            getClass: () => 'sym-name'
          }, {
            header: 'Price',
            getValue: (item) => formatPrice(item.lastPrice)
          }, {
            header: 'Volume (24h)',
            getValue: (item) => formatCompact(item.volUsdt)
          }, {
            header: '🔗',
            getValue: (item) => buildRankingTradeLink(item.symbol)
          }, ];
          container.innerHTML = buildRankingTable(items, columns);
          if (loading) loading.style.display = 'none';
        };
        const renderGainersRanking = () => {
          const container = document.getElementById('gainersContent');
          const loading = document.getElementById('gainersLoading');
          if (!container) return;
          const items = state.rankings.data.filter(x => Number.isFinite(x.pct)).slice().sort((a, b) => b.pct - a.pct)
            .slice(0, CONFIG.RANKINGS_TOP_N);
          const columns = [{
            header: '#',
            getValue: (item, idx) => `<span class="rank-num">${idx + 1}<\/span>`
          }, {
            header: '★',
            getValue: (item) => buildRankingFavStar(item.ticker)
          }, {
            header: 'Symbol',
            getValue: (item) => `<span class="sym-name" data-sym="${item.symbol}">${item.ticker}<\/span>`
          }, {
            header: 'Price',
            getValue: (item) => formatPrice(item.lastPrice)
          }, {
            header: '24h %',
            getValue: (item) => formatPct(item.pct),
            getClass: (item) => item.pct >= 0 ? 'pct-up' : 'pct-down'
          }, {
            header: '🔗',
            getValue: (item) => buildRankingTradeLink(item.symbol)
          }, ];
          container.innerHTML = buildRankingTable(items, columns);
          if (loading) loading.style.display = 'none';
        };
        const renderLosersRanking = () => {
          const container = document.getElementById('losersContent');
          const loading = document.getElementById('losersLoading');
          if (!container) return;
          const items = state.rankings.data.filter(x => Number.isFinite(x.pct)).slice().sort((a, b) => a.pct - b.pct)
            .slice(0, CONFIG.RANKINGS_TOP_N);
          const columns = [{
            header: '#',
            getValue: (item, idx) => `<span class="rank-num">${idx + 1}<\/span>`
          }, {
            header: '★',
            getValue: (item) => buildRankingFavStar(item.ticker)
          }, {
            header: 'Symbol',
            getValue: (item) => `<span class="sym-name" data-sym="${item.symbol}">${item.ticker}<\/span>`
          }, {
            header: 'Price',
            getValue: (item) => formatPrice(item.lastPrice)
          }, {
            header: '24h %',
            getValue: (item) => formatPct(item.pct),
            getClass: (item) => item.pct >= 0 ? 'pct-up' : 'pct-down'
          }, {
            header: '🔗',
            getValue: (item) => buildRankingTradeLink(item.symbol)
          }, ];
          container.innerHTML = buildRankingTable(items, columns);
          if (loading) loading.style.display = 'none';
        };
        const renderOIRanking = async () => {
          const container = document.getElementById('oiContent');
          const loading = document.getElementById('oiLoading');
          if (!container) return;
          const topByVol = state.rankings.data.slice().sort((a, b) => b.volUsdt - a.volUsdt).slice(0, 30);
          const symbols = topByVol.map(x => x.symbol);
          const oiResults = await fetchOpenInterests(symbols);
          const oiMap = new Map();
          for (const r of oiResults) {
            if (r.oi !== null) oiMap.set(r.symbol, r.oi);
          }
          const itemsWithOI = topByVol.map(x => ({
            ...x,
            oi: oiMap.get(x.symbol) || 0,
            oiNotional: (oiMap.get(x.symbol) || 0) * x.lastPrice
          })).filter(x => x.oi > 0).sort((a, b) => b.oiNotional - a.oiNotional).slice(0, CONFIG.RANKINGS_TOP_N);
          const columns = [{
            header: '#',
            getValue: (item, idx) => `<span class="rank-num">${idx + 1}<\/span>`
          }, {
            header: '★',
            getValue: (item) => buildRankingFavStar(item.ticker)
          }, {
            header: 'Symbol',
            getValue: (item) => `<span class="sym-name" data-sym="${item.symbol}">${item.ticker}<\/span>`
          }, {
            header: 'Price',
            getValue: (item) => formatPrice(item.lastPrice)
          }, {
            header: 'OI (Notional)',
            getValue: (item) => formatCompactNotional(item.oiNotional)
          }, {
            header: '🔗',
            getValue: (item) => buildRankingTradeLink(item.symbol)
          }, ];
          container.innerHTML = buildRankingTable(itemsWithOI, columns);
          if (loading) loading.style.display = 'none';
        };
        const fetchFundingRates = async () => {
          try {
            const data = await fetchJsonWithTimeout('https://fapi.binance.com/fapi/v1/premiumIndex');
            const list = Array.isArray(data) ? data : [];
            const items = [];
            for (const t of list) {
              const sym = String(t?.symbol || '').toUpperCase();
              if (!sym || !sym.endsWith('USDT')) continue;
              const rate = Number.parseFloat(t?.lastFundingRate);
              const markPrice = Number.parseFloat(t?.markPrice);
              if (!Number.isFinite(rate)) continue;
              items.push({
                symbol: sym,
                ticker: toDisplayTicker(sym),
                fundingRate: rate,
                fundingPct: rate * 100,
                markPrice: Number.isFinite(markPrice) ? markPrice : null,
              });
            }
            state.rankings.fundingData = items;
            return items;
          } catch (err) {
            console.error('Funding rate fetch error:', err);
            return state.rankings.fundingData || [];
          }
        };
        const formatFundingPct = (value) => {
          if (!Number.isFinite(value)) return '';
          const sign = value > 0 ? '+' : '';
          return `${sign}${value.toFixed(4)}%`;
        };
        const renderFundingPositiveRanking = () => {
          const container = document.getElementById('fundingPosContent');
          const loading = document.getElementById('fundingPosLoading');
          if (!container) return;
          const items = (state.rankings.fundingData || []).filter(x => x.fundingRate > 0).slice().sort((a, b) => b
            .fundingRate - a.fundingRate).slice(0, CONFIG.RANKINGS_TOP_N);
          const columns = [{
            header: '#',
            getValue: (item, idx) => `<span class="rank-num">${idx + 1}<\/span>`
          }, {
            header: '★',
            getValue: (item) => buildRankingFavStar(item.ticker)
          }, {
            header: 'Symbol',
            getValue: (item) => `<span class="sym-name" data-sym="${item.symbol}">${item.ticker}<\/span>`
          }, {
            header: 'Price',
            getValue: (item) => item.markPrice !== null ? formatPrice(item.markPrice) : '—'
          }, {
            header: 'Funding',
            getValue: (item) => formatFundingPct(item.fundingPct),
            getClass: () => 'pct-up'
          }, {
            header: '🔗',
            getValue: (item) => buildRankingTradeLink(item.symbol)
          }, ];
          container.innerHTML = buildRankingTable(items, columns);
          if (loading) loading.style.display = 'none';
        };
        const renderFundingNegativeRanking = () => {
          const container = document.getElementById('fundingNegContent');
          const loading = document.getElementById('fundingNegLoading');
          if (!container) return;
          const items = (state.rankings.fundingData || []).filter(x => x.fundingRate < 0).slice().sort((a, b) => a
            .fundingRate - b.fundingRate).slice(0, CONFIG.RANKINGS_TOP_N);
          const columns = [{
            header: '#',
            getValue: (item, idx) => `<span class="rank-num">${idx + 1}<\/span>`
          }, {
            header: '★',
            getValue: (item) => buildRankingFavStar(item.ticker)
          }, {
            header: 'Symbol',
            getValue: (item) => `<span class="sym-name" data-sym="${item.symbol}">${item.ticker}<\/span>`
          }, {
            header: 'Price',
            getValue: (item) => item.markPrice !== null ? formatPrice(item.markPrice) : '—'
          }, {
            header: 'Funding',
            getValue: (item) => formatFundingPct(item.fundingPct),
            getClass: () => 'pct-down'
          }, {
            header: '🔗',
            getValue: (item) => buildRankingTradeLink(item.symbol)
          }, ];
          container.innerHTML = buildRankingTable(items, columns);
          if (loading) loading.style.display = 'none';
        };
        const renderAllRankings = async () => {
          renderVolumeRanking();
          renderGainersRanking();
          renderLosersRanking();
          await renderOIRanking();
          await fetchFundingRates();
          renderFundingPositiveRanking();
          renderFundingNegativeRanking();
        };
        const closeRankingsWs = () => {
          if (state.rankings.reconnectTimer) {
            clearTimeout(state.rankings.reconnectTimer);
            state.rankings.reconnectTimer = null;
          }
          if (state.rankings.ws) {
            try {
              state.rankings.ws.onopen = null;
              state.rankings.ws.onclose = null;
              state.rankings.ws.onerror = null;
              state.rankings.ws.onmessage = null;
            } catch {}
            try {
              state.rankings.ws.close();
            } catch {}
            state.rankings.ws = null;
          }
        };
        const connectRankingsWebSocket = () => {
          closeRankingsWs();
          const generation = (state.rankings.wsGeneration += 1);
          const url = 'wss://fstream.binance.com/market/stream?streams=!ticker@arr/!markPrice@arr@1s';
          try {
            const ws = new WebSocket(url);
            state.rankings.ws = ws;
            ws.onopen = () => {
              if (generation !== state.rankings.wsGeneration) {
                try {
                  ws.close();
                } catch {}
                return;
              }
              if (state.rankings._wasConnected) {
                Promise.all([fetchRankingsData(), fetchFundingRates()]).then(() => renderAllRankings()).catch(
              () => {});
              }
              state.rankings._wasConnected = true;
              _binanceErrorState.wsConsecutiveFails = 0;
              state.rankings.reconnectAttempts = 0;
            };
            ws.onclose = () => {
              if (generation !== state.rankings.wsGeneration) return;
              _binanceErrorState.wsConsecutiveFails++;
              if (_binanceErrorState.wsConsecutiveFails >= 3) {
                showBinanceWarning('WebSocket Connection Issues',
                  'Encountering connection issues or Binance\'s IP limit.', );
              }
              if (navigator.onLine === false) return;
              if (state.rankings.reconnectTimer) {
                clearTimeout(state.rankings.reconnectTimer);
                state.rankings.reconnectTimer = null;
              }
              state.rankings.reconnectTimer = setTimeout(() => {
                state.rankings.reconnectTimer = null;
                if (navigator.onLine === false) return;
                state.rankings.reconnectAttempts = (state.rankings.reconnectAttempts || 0) + 1;
                if (state.rankings.reconnectAttempts > WS_MAX_RECONNECT_ATTEMPTS) {
                  return;
                }
                const delay = calcReconnectDelayMs(state.rankings.reconnectAttempts);
                state.rankings.reconnectTimer = setTimeout(() => connectRankingsWebSocket(), delay);
              }, 500);
            };
            ws.onerror = () => {
              if (generation !== state.rankings.wsGeneration) return;
            };
            ws.onmessage = (event) => {
              if (generation !== state.rankings.wsGeneration) return;
              try {
                const msg = JSON.parse(event.data);
                const stream = msg.stream;
                const data = msg.data;
                if (!stream || !data) return;
                if (stream === '!ticker@arr') {
                  if (!Array.isArray(data)) return;
                  for (const t of data) {
                    const sym = String(t?.s || '').toUpperCase();
                    if (!sym || !sym.endsWith('USDT')) continue;
                    const lastPrice = Number.parseFloat(t?.c);
                    const pct = Number.parseFloat(t?.P);
                    const quoteVol = Number.parseFloat(t?.q);
                    const vol = Number.parseFloat(t?.v);
                    if (!Number.isFinite(lastPrice)) continue;
                    const prevPrice = state.rankings.lastPrices.get(sym);
                    const prevVol = state.rankings.lastVolumes.get(sym);
                    const prevPct = state.rankings.lastPcts.get(sym);
                    state.rankings.tickerMap.set(sym, {
                      symbol: sym,
                      ticker: toDisplayTicker(sym),
                      lastPrice,
                      pct: Number.isFinite(pct) ? pct : 0,
                      volUsdt: Number.isFinite(quoteVol) ? quoteVol : 0,
                      volume: Number.isFinite(vol) ? vol : 0,
                      priceChanged: prevPrice !== lastPrice,
                      volChanged: prevVol !== quoteVol,
                      pctChanged: prevPct !== pct,
                    });
                    state.rankings.lastPrices.set(sym, lastPrice);
                    state.rankings.lastVolumes.set(sym, quoteVol);
                    state.rankings.lastPcts.set(sym, pct);
                  }
                  state.rankings.data = Array.from(state.rankings.tickerMap.values());
                }
                if (stream === '!markPrice@arr@1s') {
                  if (!Array.isArray(data)) return;
                  for (const t of data) {
                    const sym = String(t?.s || '').toUpperCase();
                    if (!sym || !sym.endsWith('USDT')) continue;
                    const rate = Number.parseFloat(t?.r);
                    const markPrice = Number.parseFloat(t?.p);
                    if (!Number.isFinite(rate)) continue;
                    state.rankings.fundingMap.set(sym, {
                      symbol: sym,
                      ticker: toDisplayTicker(sym),
                      fundingRate: rate,
                      fundingPct: rate * 100,
                      markPrice: Number.isFinite(markPrice) ? markPrice : null,
                    });
                    state.alertFundingData[sym] = {
                      value: rate * 100,
                      lastUpdate: Date.now()
                    };
                  }
                  state.rankings.fundingData = Array.from(state.rankings.fundingMap.values());
                  // Push real-time funding rate to OI Price Panel
                  if (oiPricePanel.symbol) {
                    const wsFunding = state.rankings.fundingMap.get(oiPricePanel.symbol);
                    if (wsFunding && Number.isFinite(wsFunding.fundingRate)) {
                      if (oiPricePanel.stats.realtimeFundingRate !== wsFunding.fundingRate) {
                        oiPricePanel.stats.realtimeFundingRate = wsFunding.fundingRate;
                        // Re-render signal remark with updated funding context (throttled, max once per 5s)
                        if (!oiPricePanel._wsRemarkTimer) {
                          oiPricePanel._wsRemarkTimer = setTimeout(() => {
                            // Only re-render if we still have a classification (skip if symbol changed mid-flight)
                            if (oiPricePanel.classification && oiPricePanel.classification.scenarios && oiPricePanel.symbol) {
                              oiPricePanel.renderSignalRemark();
                            }
                            oiPricePanel._wsRemarkTimer = null;
                          }, 5000);
                        }
                      }
                    }
                  }
                }
              } catch {}
            };
          } catch {
            if (navigator.onLine === false) return;
            state.rankings.reconnectTimer = setTimeout(() => connectRankingsWebSocket(), 5000);
          }
        };
        const renderRankingsRealtime = () => {
          if (document.hidden) return;
          if (state.rankings.data.length > 0) {
            renderVolumeRanking();
            renderGainersRanking();
            renderLosersRanking();
          }
          if (state.rankings.fundingData.length > 0) {
            renderFundingPositiveRanking();
            renderFundingNegativeRanking();
          }
          updateRankingFavStars('oiContent');
        };
        const updateRankingFavStars = (containerId) => {
          const container = document.getElementById(containerId);
          if (!container) return;
          container.querySelectorAll('.ranking-fav-star').forEach(btn => {
            const ticker = btn.getAttribute('data-rank-fav');
            if (!ticker) return;
            const isFav = isFavoriteTicker(ticker);
            btn.classList.toggle('fav', isFav);
            btn.textContent = isFav ? '★' : '☆';
            btn.title = isFav ? 'Remove from favourites' : 'Add to favourites';
          });
        };
        const initRankings = async () => {
          await Promise.all([fetchRankingsData(), fetchFundingRates()]);
          await renderAllRankings();
          document.getElementById('rankingsGrid')?.addEventListener('click', (e) => {
            const favBtn = e.target.closest('.ranking-fav-star');
            if (favBtn) {
              e.preventDefault();
              e.stopPropagation();
              const ticker = favBtn.getAttribute('data-rank-fav');
              if (ticker) {
                toggleFavoriteTicker(ticker);
                renderRankingsRealtime();
              }
              return;
            }
            const tradeLink = e.target.closest('.ranking-trade-link');
            if (tradeLink) {
              return;
            }
            const symEl = e.target.closest('.sym-name');
            if (symEl) {
              const sym = symEl.getAttribute('data-sym');
              if (sym) loadSymbol(sym);
            }
          });
          connectRankingsWebSocket();
          state.rankings.renderTimer = setInterval(() => {
            renderRankingsRealtime();
          }, CONFIG.RANKINGS_RENDER_MS);
          state.rankings.oiTimer = setInterval(async () => {
            if (!document.hidden) {
              try {
                await renderOIRanking();
              } catch {}
            }
          }, 30000);
        };
//RSI CALCULATION
        const calcRSI = (candles, period = 14) => {
          if (!candles || candles.length < period + 1) return null;
          let gains = 0,
            losses = 0;
          for (let i = 0; i < period; i++) {
            const change = candles[i + 1].close - candles[i].close;
            if (change >= 0) gains += change;
            else losses -= change;
          }
          let avgGain = gains / period;
          let avgLoss = losses / period;
          for (let i = period; i < candles.length - 1; i++) {
            const change = candles[i + 1].close - candles[i].close;
            if (change >= 0) {
              avgGain = (avgGain * (period - 1) + change) / period;
              avgLoss = (avgLoss * (period - 1)) / period;
            } else {
              avgGain = (avgGain * (period - 1)) / period;
              avgLoss = (avgLoss * (period - 1) - change) / period;
            }
          }
          if (avgLoss === 0) return 100;
          const rs = avgGain / avgLoss;
          return 100 - (100 / (1 + rs));
        };
        const getRsiClass = (rsi) => {
          if (!Number.isFinite(rsi)) return 'neutral';
          if (rsi >= 70) return 'overbought';
          if (rsi <= 30) return 'oversold';
          return 'neutral';
        };
        const formatRsi = (rsi) => {
          if (!Number.isFinite(rsi)) return '';
          return `RSI ${Math.round(rsi)}`;
        };

// MULTI-TICKER TRACKER
    const MAX_TRACKERS = 4;
        const TRACKER_INTERVALS = ['15m', '1h', '4h', '1d', '1w'];
        const stateTracker = {
          symbols: [],
          interval: '1h',
          cards: [],
          data: {},
          timer: null,
          renderTimer: null,
          _wasConnected: false,
        };
        const loadTrackerSymbols = () => {
          try {
            const raw = localStorage.getItem('pv_tracker_symbols');
            if (!raw) return [];
            const parsed = JSON.parse(raw);
            if (!Array.isArray(parsed)) return [];
            const result = parsed.slice(0, MAX_TRACKERS).map(s => normalizeSymbol(s)).filter(Boolean);
            return result;
          } catch {
            return [];
          }
        };
        const saveTrackerSymbols = () => {
          try {
            safeLocalStorageSet('pv_tracker_symbols', JSON.stringify(stateTracker.symbols));
          } catch {}
        };
        const buildTrackerCardHTML = (index, symbol) => {
          const display = symbol ? toDisplayTicker(symbol) : '';
          return `
        <div class="tracker-card" id="trackerCard${index}" data-index="${index}">
          <div class="tracker-card-header-row">
            <input type="text" id="trackerInput${index}" class="tracker-dropdown-input" placeholder="Ticker" value="${display}" autocomplete="off" data-tracker-index="${index}" list="alertTickerDatalist" />
            <span class="tracker-symbol" id="trackerSymbol${index}">${display || '--'}</span>
            <span class="tracker-price" id="trackerPrice${index}">--</span>
          </div>
          <div class="tracker-chart-container">
            <canvas id="trackerCanvas${index}" style="width:100%;height:100%;display:block;" role="img" aria-label="Tracker ${index + 1} candlestick chart for ${display}"></canvas>
          </div>
          <div class="tracker-meta">
            <span id="trackerChange${index}">--</span>
            <span class="tracker-rsi" id="trackerRsi${index}">--</span>
          </div>
        </div>`;
        };
        const buildEmptyTrackerCard = (index) => {
          return `
        <div class="tracker-card empty" id="trackerCard${index}" data-index="${index}">
          <div class="tracker-card-header-row">
            <input type="text" id="trackerInput${index}" class="tracker-dropdown-input" placeholder="Ticker" autocomplete="off" data-tracker-index="${index}" list="alertTickerDatalist" />
          </div>
          <div style="font-size:2rem;margin-bottom:8px;">📈</div>
          <div>Select a ticker above</div>
        </div>`;
        };
        const renderTrackerGrid = () => {
          const grid = document.getElementById('multiTickerGrid');
          if (!grid) return;
          let html = '';
          for (let i = 0; i < MAX_TRACKERS; i++) {
            html += stateTracker.symbols[i] ? buildTrackerCardHTML(i, stateTracker.symbols[i]) :
              buildEmptyTrackerCard(i);
          }
          grid.innerHTML = html;
          for (let i = 0; i < MAX_TRACKERS; i++) {
            const inp = document.getElementById(`trackerInput${i}`);
            if (inp) {
              const slotIndex = i;
              inp.setAttribute('list', 'alertTickerDatalist');
              inp.setAttribute('autocomplete', 'off');
              inp.addEventListener('change', () => {
                const val = inp.value.trim();
                if (val) {
                  const sym = normalizeSymbol(val);
                  if (sym) {
                    setTrackerSymbol(slotIndex, sym);
                  }
                }
              });
              inp.addEventListener('blur', () => {
                const val = inp.value.trim();
                if (val) {
                  const sym = normalizeSymbol(val);
                  if (sym) {
                    setTrackerSymbol(slotIndex, sym);
                    return;
                  }
                }
                setTimeout(() => {
                  const currentSym = stateTracker.symbols[slotIndex];
                  if (currentSym) {
                    inp.value = toDisplayTicker(currentSym);
                  } else {
                    inp.value = '';
                  }
                }, 100);
              });
              inp.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                  const val = inp.value.trim();
                  if (val) {
                    const sym = normalizeSymbol(val);
                    if (sym) setTrackerSymbol(slotIndex, sym);
                  }
                }
              });
            }
          }
          for (let i = 0; i < MAX_TRACKERS; i++) {
            const symbolEl = document.getElementById(`trackerSymbol${i}`);
            if (symbolEl && stateTracker.symbols[i]) {
              const sym = stateTracker.symbols[i];
              symbolEl.addEventListener('click', () => {
                loadSymbol(sym);
              });
            }
          }
          stateTracker.cards = [];
          for (let i = 0; i < MAX_TRACKERS; i++) {
            if (stateTracker.symbols[i]) {
              const canvas = document.getElementById(`trackerCanvas${i}`);
              if (canvas) {
                resizeCanvasToContainer(canvas);
                observeChartCanvas(canvas);
              }
              stateTracker.cards[i] = {
                canvas: canvas,
                symbol: stateTracker.symbols[i],
                candles: [],
                dirty: true,
                hoverPrice: null,
                hoverIndex: null,
              };
              try {
                const cacheKey = `pv_tk_${stateTracker.symbols[i]}_${stateTracker.interval}`;
                const cached = sessionStorage.getItem(cacheKey);
                if (cached) {
                  const parsed = JSON.parse(cached);
                  if (parsed.candles && Array.isArray(parsed.candles) && (Date.now() - parsed.savedAt < 600000)) {
                    stateTracker.cards[i].candles = parsed.candles;
                    stateTracker.cards[i].dirty = true;
                  } else {
                    sessionStorage.removeItem(cacheKey);
                  }
                }
              } catch {}
              if (canvas) {
                const cardIdx = i;
                canvas.addEventListener('mousemove', (e) => {
                  const card = stateTracker.cards[cardIdx];
                  if (!card || !card.candles || card.candles.length === 0) return;
                  const price = getPriceAtCanvasY(canvas, card.candles, e.clientY);
                  const next = Number.isFinite(price) ? price : null;
                  const idx = getCandleIndexAtCanvasX(canvas, card.candles, e.clientX);
                  if (card.hoverPrice === next && card.hoverIndex === idx) return;
                  card.hoverPrice = next;
                  card.hoverIndex = idx;
                  card.dirty = true;
                  drawTrackerChart(card);
                });
                canvas.addEventListener('mouseleave', () => {
                  const card = stateTracker.cards[cardIdx];
                  if (!card) return;
                  if (card.hoverPrice === null && card.hoverIndex === null) return;
                  card.hoverPrice = null;
                  card.hoverIndex = null;
                  card.dirty = true;
                  drawTrackerChart(card);
                });
                canvas.addEventListener('contextmenu', (e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  const card = stateTracker.cards[cardIdx];
                  if (!card || !card.candles || card.candles.length === 0) return;
                  const price = getPriceAtCanvasY(canvas, card.candles, e.clientY);
                  if (!Number.isFinite(price)) return;
                  const sym = stateTracker.symbols[cardIdx] || '';
                  const title = `${sym ? toDisplayTicker(sym) : 'Tracker'} level`;
                  showChartContextMenu(e.clientX, e.clientY, title, price);
                });
                {
                  let _lpTimer = null;
                  let _lpX = 0,
                    _lpY = 0;
                  canvas.addEventListener('touchstart', (e) => {
                    const t = e.touches[0];
                    _lpX = t.clientX;
                    _lpY = t.clientY;
                    _lpTimer = setTimeout(() => {
                      const card = stateTracker.cards[cardIdx];
                      if (!card || !card.candles || card.candles.length === 0) return;
                      const price = getPriceAtCanvasY(canvas, card.candles, _lpY);
                      if (!Number.isFinite(price)) return;
                      const sym = stateTracker.symbols[cardIdx] || '';
                      const title = `${sym ? toDisplayTicker(sym) : 'Tracker'} level`;
                      showChartContextMenu(_lpX, _lpY, title, price);
                      _lpTimer = null;
                    }, 500);
                  }, {
                    passive: true
                  });
                  canvas.addEventListener('touchmove', () => {
                    if (_lpTimer) {
                      clearTimeout(_lpTimer);
                      _lpTimer = null;
                    }
                  }, {
                    passive: true
                  });
                  canvas.addEventListener('touchend', () => {
                    if (_lpTimer) {
                      clearTimeout(_lpTimer);
                      _lpTimer = null;
                    }
                  }, {
                    passive: true
                  });
                  canvas.addEventListener('touchcancel', () => {
                    if (_lpTimer) {
                      clearTimeout(_lpTimer);
                      _lpTimer = null;
                    }
                  }, {
                    passive: true
                  });
                }
              }
            }
          }
        };
        const setTrackerSymbol = (index, symbol) => {
          const sym = normalizeSymbol(symbol);
          if (!sym) return;
          const existingIdx = stateTracker.symbols.indexOf(sym);
          if (existingIdx >= 0 && existingIdx !== index) {
            const oldSym = stateTracker.symbols[index];
            stateTracker.symbols[existingIdx] = oldSym || '';
            if (stateTracker.cards[existingIdx]) {
              stateTracker.cards[existingIdx].candles = [];
              stateTracker.cards[existingIdx].dirty = true;
            }
          }
          stateTracker.symbols[index] = sym;
          saveTrackerSymbols();
          renderTrackerGrid();
          restartTrackerWS();
          fetchTrackerKlines();
        };
        const fetchTrackerKlines = async () => {
          // Phase 1: Load from sessionStorage cache for instant display
          for (let i = 0; i < stateTracker.symbols.length; i++) {
            const sym = stateTracker.symbols[i];
            if (!sym) continue;
            if (stateTracker.cards[i] && stateTracker.cards[i].candles.length > 0) continue; // already have data
            try {
              const cacheKey = `pv_tk_${sym}_${stateTracker.interval}`;
              const cached = sessionStorage.getItem(cacheKey);
              if (cached) {
                const parsed = JSON.parse(cached);
                if (parsed.candles && Array.isArray(parsed.candles) && parsed.candles.length > 0) {
                  // Only use cache if less than 5 minutes old
                  if (!parsed.savedAt || (Date.now() - parsed.savedAt) < 300000) {
                    stateTracker.cards[i].candles = parsed.candles;
                    stateTracker.cards[i].dirty = true;
                  }
                }
              }
            } catch {}
          }
          // Show cached data immediately before waiting for API
          updateTrackerUI();
          // Phase 2: Refresh from REST API
          const fetchPromises = [];
          for (let i = 0; i < stateTracker.symbols.length; i++) {
            const sym = stateTracker.symbols[i];
            if (!sym) continue;
            const idx = i;
            fetchPromises.push(fetchExchangeKlines(sym, stateTracker.interval, CONFIG.KLINE_LIMIT).then(candles => {
              if (stateTracker.cards[idx]) {
                stateTracker.cards[idx].candles = candles;
                stateTracker.cards[idx].dirty = true;
                try {
                  const cacheKey = `pv_tk_${sym}_${stateTracker.interval}`;
                  sessionStorage.setItem(cacheKey, JSON.stringify({
                    candles: candles,
                    savedAt: Date.now()
                  }));
                } catch {}
              }
            }).catch(() => {}));
          }
          await Promise.all(fetchPromises);
          updateTrackerUI();
        };
        const drawTrackerChart = (card) => {
          if (!card || !card.canvas || !card.candles.length) return;
          drawCandlestickChart(card.canvas, card.candles, card.hoverPrice, card.hoverIndex, null, [], []);
          card.dirty = false;
        };
        const updateTrackerUI = () => {
          for (let i = 0; i < stateTracker.symbols.length; i++) {
            const sym = stateTracker.symbols[i];
            if (!sym) continue;
            const data = stateTracker.data[sym];
            if (!data) continue;
            const priceEl = document.getElementById(`trackerPrice${i}`);
            const changeEl = document.getElementById(`trackerChange${i}`);
            const rsiEl = document.getElementById(`trackerRsi${i}`);
            const symbolEl = document.getElementById(`trackerSymbol${i}`);
            if (symbolEl) symbolEl.textContent = toDisplayTicker(sym);
            if (priceEl && Number.isFinite(data.price)) {
              const oldPrice = parseFloat(priceEl.getAttribute('data-price')) || 0;
              priceEl.textContent = formatPrice(data.price);
              priceEl.setAttribute('data-price', data.price);
              priceEl.classList.remove('up', 'down');
              if (oldPrice && data.price > oldPrice) priceEl.classList.add('up');
              else if (oldPrice && data.price < oldPrice) priceEl.classList.add('down');
            }
            const card = stateTracker.cards[i];
            if (changeEl && card && card.candles.length) {
              const last = card.candles[card.candles.length - 1];
              if (Number.isFinite(last.open) && last.open !== 0) {
                const diff = last.close - last.open;
                const pct = (diff / last.open) * 100;
                const volUsdt = Number.isFinite(last.volume) ? last.volume : null;
                const volText = Number.isFinite(volUsdt) ? `, ${formatUsdtVolume(volUsdt)}` : '';
                changeEl.textContent = `${diff >= 0 ? '+' : ''}${pct.toFixed(2)}%${volText}`;
                changeEl.style.color = diff >= 0 ? 'var(--good-bright)' : 'var(--bad)';
              }
            }
            if (rsiEl && card && card.candles.length >= 15) {
              const rsi = calcRSI(card.candles);
              rsiEl.textContent = formatRsi(rsi);
              rsiEl.className = 'tracker-rsi ' + getRsiClass(rsi);
            }
          }
        };
        const restartTrackerWS = () => {
          stateTracker.data = {};
          if (stateTracker.symbols.filter(Boolean).length > 0) reconnectPrimaryWs();
        };
        const startTrackerRenderLoop = () => {
          if (stateTracker.renderTimer) clearInterval(stateTracker.renderTimer);
          stateTracker.renderTimer = setInterval(() => {
            if (document.hidden) return;
            updateTrackerUI();
            for (const card of stateTracker.cards) {
              if (card && card.dirty) drawTrackerChart(card);
            }
          }, 1000);
        };
        const loadTrackerInterval = () => {
          try {
            const raw = localStorage.getItem('pv_tracker_interval');
            if (raw && TRACKER_INTERVALS.includes(raw)) return raw;
          } catch {}
          return '1h';
        };
        const saveTrackerInterval = () => {
          try {
            safeLocalStorageSet('pv_tracker_interval', stateTracker.interval);
          } catch {}
        };
        const updateTrackerInterval = (newInterval) => {
          if (!TRACKER_INTERVALS.includes(newInterval)) return;
          if (stateTracker.interval === newInterval) return;
          stateTracker.interval = newInterval;
          saveTrackerInterval();
          const slider = document.getElementById('trackerTimeframeSlider');
          if (slider) {
            slider.querySelectorAll('.tracker-tf-btn').forEach(btn => {
              btn.classList.toggle('active', btn.getAttribute('data-tf') === newInterval);
            });
          }
          for (const card of stateTracker.cards) {
            if (card) {
              card.hoverPrice = null;
              card.hoverIndex = null;
            }
          }
          fetchTrackerKlines().then(() => {
            restartTrackerWS();
          });
        };
        const initTracker = () => {
          const DEFAULT_TRACKER_SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT'];
          stateTracker.symbols = loadTrackerSymbols();
          stateTracker.interval = loadTrackerInterval();
          if (!stateTracker.symbols || stateTracker.symbols.length === 0) {
            stateTracker.symbols = [...DEFAULT_TRACKER_SYMBOLS];
            saveTrackerSymbols();
          } else {
            while (stateTracker.symbols.length < MAX_TRACKERS) {
              const defSym = DEFAULT_TRACKER_SYMBOLS[stateTracker.symbols.length] || '';
              stateTracker.symbols.push(defSym);
            }
            saveTrackerSymbols();
          }
          const slider = document.getElementById('trackerTimeframeSlider');
          if (slider) {
            slider.querySelectorAll('.tracker-tf-btn').forEach(btn => {
              btn.classList.toggle('active', btn.getAttribute('data-tf') === stateTracker.interval);
            });
            slider.addEventListener('click', (e) => {
              const btn = e.target.closest('.tracker-tf-btn');
              if (!btn) return;
              const tf = btn.getAttribute('data-tf');
              if (tf) updateTrackerInterval(tf);
            });
          }
          renderTrackerGrid();
          const activeSymbols = stateTracker.symbols.filter(Boolean);
          if (activeSymbols.length > 0) {
            fetchTrackerKlines().then(() => {
              restartTrackerWS();
              startTrackerRenderLoop();
            });
          }
        };
        const initViewToggles = () => {
          const trackerSection = document.getElementById('multiTickerSection');
          if (trackerSection) {
            if (stateTracker.symbols.filter(Boolean).length > 0) {
              if (!state.ws) reconnectPrimaryWs();
              startTrackerRenderLoop();
            }
          }
        };
        const initUI = () => {
          const grid = document.getElementById('tickerGrid');
          grid.innerHTML = '';
          const card = buildCard(state.symbol);
          grid.appendChild(card);
          state.elements = {
            card,
            tickerTitle: card.querySelector('#tickerTitle'),
            headerPrice: card.querySelector('#headerPrice'),
            compositeTickerTitle: card.querySelector('#compositeTickerTitle'),
            compositeTickerPrice: card.querySelector('#compositeTickerPrice'),
            copyPriceBtn: card.querySelector('#copyPriceBtn'),
            tickerInput: card.querySelector('#tickerInput'),
            tradeBtn: card.querySelector('#tradeBtn'),
            statusText: card.querySelector('#statusText'),
            timestampText: card.querySelector('#timestampText'),
          };
          initChartsState();
          if (state.elements.tickerInput) {
            state.elements.tickerInput.value = state.urlSymbolMode ? toDisplayTicker(state.symbol) : '';
            state.elements.tickerInput.removeAttribute('list');
            state.elements.tickerInput.setAttribute('autocomplete', 'off');
            state.elements.tickerInput.addEventListener('focus', () => {
              state.tickerSuggest.activeInput = state.elements.tickerInput;
              state.tickerSuggest.onSelectCallback = null;
              renderTickerSuggestMenu();
              if (window.visualViewport) {
                document.body.classList.add('mobile-keyboard-open');
                const scrollInputAboveKeyboard = () => {
                  const input = state.elements.tickerInput;
                  if (!input) return;
                  const rect = input.getBoundingClientRect();
                  const vv = window.visualViewport;
                  const inputBottom = rect.bottom;
                  const visibleBottom = vv.height + vv.offsetTop;
                  if (inputBottom > visibleBottom || rect.top < vv.offsetTop) {
                    input.scrollIntoView({
                      behavior: 'smooth',
                      block: 'center'
                    });
                  }
                };
                setTimeout(scrollInputAboveKeyboard, 150);
                setTimeout(scrollInputAboveKeyboard, 400);
                vv.addEventListener('resize', scrollInputAboveKeyboard);
                vv.addEventListener('scroll', scrollInputAboveKeyboard);
              } else {
                setTimeout(() => {
                  state.elements.tickerInput.scrollIntoView({
                    behavior: 'smooth',
                    block: 'center'
                  });
                }, 300);
              }
            });
            state.elements.tickerInput.addEventListener('input', () => {
              saveStored(STORAGE.tickerInput, state.elements.tickerInput.value);
              clearTimeout(state.tickerInputDebounce);
              state.tickerInputDebounce = setTimeout(() => {
                renderTickerSuggestMenu();
              }, 300);
            });
            state.elements.tickerInput.addEventListener('blur', async () => {
              document.body.classList.remove('mobile-keyboard-open');
              if (Date.now() < state.tickerSuggest.ignoreBlurUntil) return;
              setTimeout(() => {
                if (state.tickerSuggest.visible) return;
                const v = state.elements.tickerInput.value;
                const next = normalizeSymbol(v);
                saveStored(STORAGE.tickerInput, v);
                if (next && next !== state.symbol) loadSymbol(v);
              }, 200);
            });
          }
          initTickerAutocomplete();
          const ensureAlertPermission = () => {
            ensureAudioContext();
            if (!hasAlertPermission()) {
              requestNotificationPermission();
              setAlertPermission();
            }
          };
          renderAlertSlots();
          restoreAlertLogUI();
          renderFavTickers();
          const debouncedStartAlertMonitor = () => {
            clearTimeout(_alertWsDebounce);
            _alertWsDebounce = setTimeout(() => startMultiAlertMonitor(), 1500);
          };
          if (state.multiAlerts.length > 0) startMultiAlertMonitor();
          oiPricePanel.init();
          let _oiResizeTimer = 0;
          window.addEventListener('resize', () => {
            clearTimeout(_oiResizeTimer);
            _oiResizeTimer = setTimeout(() => {
              if (oiPricePanel.classification && oiPricePanel.symbol) {
                oiPricePanel.renderQuadrant();
                oiPricePanel.renderCompositeSparkline();
                oiPricePanel.renderPriceSparkline();
                oiPricePanel.renderZPriceSparkline();
                oiPricePanel.renderOiSparkline();
                oiPricePanel.renderContextRow();
              }
            }, 120);
          });
          for (let i = 0; i < 4; i++) {
            const tickerInput = document.getElementById(`alertTicker${i + 1}`);
            const typeSelect = document.getElementById(`alertType${i + 1}`);
            const priceInput = document.getElementById(`alertPrice${i + 1}`);
            const removeBtn = document.getElementById(`removeAlert${i + 1}`);
            const getAlertType = () => typeSelect ? typeSelect.value : 'price';
            const saveAlertFromInputs = () => {
              const ticker = tickerInput ? tickerInput.value.trim() : '';
              const price = priceInput ? priceInput.value : '';
              const alertType = getAlertType();
              const sym = normalizeSymbol(ticker);
              const p = parseAlertPrice(price);
              if (sym && Number.isFinite(p)) {
                while (state.multiAlerts.length <= i && state.multiAlerts.length < 4) {
                  state.multiAlerts.push(null);
                }
                if (i < state.multiAlerts.length) {
                  state.multiAlerts[i] = {
                    ticker: sym,
                    alertType,
                    threshold: p,
                    lastTriggered: state.multiAlerts[i]?.lastTriggered || 0,
                    lastValue: null
                  };
                }
                saveMultiAlerts(state.multiAlerts);
                debouncedStartAlertMonitor();
              }
            };
            if (tickerInput) {
              tickerInput.addEventListener('focus', ensureAlertPermission);
              tickerInput.addEventListener('change', () => {
                updateMultiAlert(i, tickerInput.value, priceInput ? priceInput.value : '', getAlertType());
              });
              tickerInput.addEventListener('input', () => {
                saveAlertFromInputs();
              });
            }
            if (typeSelect) {
              typeSelect.addEventListener('change', () => {
                const config = ALERT_TYPE_CONFIG[typeSelect.value];
                if (config && priceInput) priceInput.placeholder = config.placeholder;
                const ticker = tickerInput ? tickerInput.value.trim() : '';
                const price = priceInput ? priceInput.value : '';
                if (ticker && price) {
                  updateMultiAlert(i, ticker, price, typeSelect.value);
                }
              });
            }
            if (priceInput) {
              priceInput.addEventListener('focus', ensureAlertPermission);
              priceInput.addEventListener('change', () => {
                updateMultiAlert(i, tickerInput ? tickerInput.value : '', priceInput.value, getAlertType());
              });
              priceInput.addEventListener('input', () => {
                saveAlertFromInputs();
              });
            }
            if (removeBtn) {
              removeBtn.addEventListener('mousedown', (e) => e.preventDefault());
              removeBtn.addEventListener('click', () => {
                removeMultiAlert(i);
              });
            }
            const loadBtn = document.getElementById(`alertLoad${i + 1}`);
            if (loadBtn) {
              loadBtn.addEventListener('click', () => {
                const alert = state.multiAlerts[i];
                if (alert && alert.ticker) {
                  loadSymbol(alert.ticker);
                }
              });
            }
            const copyRtBtn = document.getElementById(`alertCopyRt${i + 1}`);
            if (copyRtBtn) {
              copyRtBtn.addEventListener('click', async () => {
                const rtEl = document.getElementById(`alertRtPrice${i + 1}`);
                const priceText = rtEl ? rtEl.textContent : '';
                if (!priceText || priceText === '--') return;
                const ok = await copyText(priceText);
                copyRtBtn.classList.add('copied');
                copyRtBtn.textContent = ok ? '✓' : '✕';
                setTimeout(() => {
                  copyRtBtn.classList.remove('copied');
                  copyRtBtn.textContent = '⧉';
                }, 1200);
              });
            }
          }
          const alertPanel = document.getElementById('multiAlertPanel');
          if (alertPanel) {
            alertPanel.addEventListener('click', ensureAlertPermission, {
              once: true
            });
            alertPanel.addEventListener('focusin', ensureAlertPermission, {
              once: true
            });
          }
          if (state.elements.copyPriceBtn) {
            state.elements.copyPriceBtn.addEventListener('click', async () => {
              const plain = formatPlainNumber(state.currentPrice);
              const ok = await copyText(plain);
              state.elements.copyPriceBtn.classList.add('copied');
              state.elements.copyPriceBtn.textContent = ok ? 'Copied' : 'Failed';
              setTimeout(() => {
                state.elements.copyPriceBtn.classList.remove('copied');
                state.elements.copyPriceBtn.textContent = '⧉';
              }, 1200);
            });
          }
          updatePriceUI();
          updateStatus();
          updateCountdowns();
          if (state.elements.tradeBtn) {
            state.elements.tradeBtn.addEventListener('click', () => {
              const url = getBinanceFuturesUrl(state.symbol);
              try {
                const w = window.open(url, '_blank', 'noopener,noreferrer');
                if (w) w.opener = null;
              } catch {
                window.location.href = url;
              }
            });
          }
          // Search X button — open X search for the current ticker
          const searchXBtn = document.getElementById('searchXBtn');
          if (searchXBtn) {
            searchXBtn.addEventListener('click', () => {
              const ticker = (state.symbol || '').replace('USDT', '');
              if (!ticker) return;
              const url = `https://x.com/search?q=%24${encodeURIComponent(ticker)}&src=typed_query`;
              try {
                const w = window.open(url, '_blank', 'noopener,noreferrer');
                if (w) w.opener = null;
              } catch {
                window.location.href = url;
              }
            });
          }
          state.elements.tickerInput.addEventListener('keydown', async (e) => {
            if (e.key === 'ArrowDown') {
              if (!state.tickerSuggest.visible) renderTickerSuggestMenu();
              moveTickerSuggestActive(1);
              e.preventDefault();
              return;
            }
            if (e.key === 'ArrowUp') {
              if (!state.tickerSuggest.visible) renderTickerSuggestMenu();
              moveTickerSuggestActive(-1);
              e.preventDefault();
              return;
            }
            if (e.key === 'Escape') {
              hideTickerSuggestMenu();
              return;
            }
            if (e.key === 'Enter') {
              if (acceptTickerSuggestActive()) {
                e.preventDefault();
                return;
              }
              const v = state.elements.tickerInput.value;
              saveStored(STORAGE.tickerInput, v);
              await loadSymbol(v);
            }
          });
          window.addEventListener('resize', () => {
            for (const interval of CONFIG.INTERVALS) {
              const chart = state.charts[interval];
              if (chart) chart.dirty = true;
            }
            markChartDirty();
          });
          const setVH = () => {
            document.documentElement.style.setProperty('--vh', `${window.innerHeight * 0.01}px`);
          };
          setVH();
          window.addEventListener('resize', setVH);
          initRankings();
          initTracker();
          initViewToggles();
          const stickyNav = document.getElementById('stickyNav');
          if (stickyNav) {
            stickyNav.addEventListener('click', (e) => {
              const btn = e.target.closest('.nav-btn');
              if (!btn) return;
              stickyNav.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
              btn.classList.add('active');
              const target = btn.getAttribute('data-nav');
              if (target === 'charts') {
                const chartList = document.querySelector('.chart-list');
                if (chartList) chartList.scrollIntoView({
                  behavior: 'smooth',
                  block: 'start'
                });
              } else if (target === 'alerts') {
                const alertPanel = document.getElementById('multiAlertPanel');
                if (alertPanel) alertPanel.scrollIntoView({
                  behavior: 'smooth',
                  block: 'start'
                });
              } else if (target === 'trackers') {
                const trackerSection = document.getElementById('multiTickerSection');
                if (trackerSection) trackerSection.scrollIntoView({
                  behavior: 'smooth',
                  block: 'start'
                });
              } else if (target === 'rankings') {
                const rankingsSection = document.getElementById('rankingsSection');
                if (rankingsSection) rankingsSection.scrollIntoView({
                  behavior: 'smooth',
                  block: 'start'
                });
              } else if (target === 'multioi') {
                const mfPanel = document.getElementById('oiPricePanel');
                if (mfPanel) mfPanel.scrollIntoView({
                  behavior: 'smooth',
                  block: 'start'
                });
              }
            });
          }
          document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
              oiPricePanel.stopAutoRefresh();
            } else {
              state.alertPrices = {};
              for (const alert of (state.multiAlerts || [])) {
                if (alert) alert.lastValue = null;
              }
              if (state.symbol && state.isRunning) {
                oiPricePanel.startAutoRefresh(state.symbol);
              }
            }
          });
          window.addEventListener('beforeunload', () => {
            if (_alertWorker) {
              _alertWorker.postMessage({
                command: 'stop'
              });
              _alertWorker.terminate();
              _alertWorker = null;
            }
            if (_alertWorkerBlobUrl) {
              URL.revokeObjectURL(_alertWorkerBlobUrl);
              _alertWorkerBlobUrl = null;
            }
          });

//Blog Modal
      const blogData = [
        {
            id: 'multi-timeframe',
            title: 'How to Use Multi-Timeframe Analysis Like a Pro Trader',
            date: 'May 5, 2026',
            tag: 'Technical Analysis',
            keywords: ['multi-timeframe analysis', 'crypto technical analysis', 'chart timeframes',
              'Binance Futures trading strategy', 'scalping vs swing trading'
            ],
            hashtags: ['#MultiTimeframeAnalysis', '#CryptoTrading', '#BinanceFutures', '#TechnicalAnalysis',
              '#CandlestickCharts', '#TradingStrategy', '#MultiPerps'
            ],
            excerpt: 'Master the art of reading crypto charts across multiple timeframes to identify high-probability trade setups, avoid false breakouts, and align your entries with the dominant trend direction.',
            content: `<h2>How to Use Multi-Timeframe Analysis Like a Pro Trader<\/h2><div class="blog-meta"><span class="tag">Technical Analysis<\/span><span>May 5, 2026 · 6 min read<\/span><\/div><p>Multi-timeframe analysis is the practice of examining price action across several chart intervals before entering a trade on Binance Futures or any crypto market. Instead of relying on a single 15-minute or 1-hour chart, professional traders stack the 1-minute, 5-minute, 15-minute, 1-hour, 4-hour, and daily views to build a complete market narrative. This approach dramatically reduces false signals and helps you trade with conviction rather than guesswork.<\/p><h3>Why Multi-Timeframe Analysis Matters<\/h3><p>A bullish setup on the 5-minute chart can be completely invalidated by a bearish trend on the 4-hour timeframe. By aligning the higher timeframe bias with the lower timeframe entry, you dramatically improve your win rate and risk-reward ratio. The higher timeframe acts as the "director" setting the overall scene, while the lower timeframe provides the "stage" for precise execution. Trading against the higher timeframe trend is one of the most common mistakes beginner crypto traders make — and it is entirely avoidable with multi-timeframe analysis.<\/p><h3>The Top-Down Approach: Step by Step<\/h3><ol><li><strong>Daily / Weekly Timeframe:<\/strong> Identify the macro trend direction and key support/resistance zones. This is your battlefield map — it tells you the overall terrain and where the major obstacles lie.<\/li><li><strong>4-Hour Timeframe:<\/strong> Confirm the trend direction and spot intermediate market structure like higher highs, lower lows, and consolidation patterns. This timeframe filters out the noise of lower intervals.<\/li><li><strong>1-Hour / 15-Minute Timeframe:<\/strong> Look for precise entry zones using candlestick patterns, trendline breaks, and RSI divergence. This is where you refine your trade plan.<\/li><li><strong>5-Minute / 1-Minute Timeframe:<\/strong> Time your actual entry with minimal risk and tight stop-loss placement. Scalpers use these intervals for pin-point execution, but the setup must agree with higher timeframes.<\/li><\/ol><h3>Practical Tips for Binance Futures Traders<\/h3><p>Always trade in the direction of the higher timeframe trend. If the daily chart is bullish, only look for long setups on lower timeframes — never fight the macro trend for a quick scalp. Use the 1-minute chart for scalping entries but never ignore what the 4-hour chart is telling you. MultiPerps's multi-chart layout makes this workflow effortless by displaying all nine key timeframes (1m, 5m, 15m, 30m, 1h, 4h, 1d, 1w, 1M) side-by-side in real time, directly via Binance WebSocket feeds.<\/p><p><strong>Key takeaway:<\/strong> Multi-timeframe analysis is not about finding more trades — it is about finding <em>better<\/em> trades. When all timeframes align, your probability of success increases significantly.<\/p>`
          }, {
            id: 'open-interest',
            title: 'What is Open Interest in Crypto Futures? Why Traders Should Monitor OI',
            date: 'May 3, 2026',
            tag: 'Market Data',
            keywords: ['open interest', 'crypto OI', 'Binance open interest', 'futures market data',
              'crypto market sentiment'
            ],
            hashtags: ['#OpenInterest', '#CryptoFutures', '#BinanceFutures', '#MarketData', '#TradingIndicators',
              '#CryptoAnalysis', '#MultiPerps'
            ],
            excerpt: 'Open Interest reveals how much capital is actually committed to a crypto futures market. Learn how rising or falling OI signals trend strength, potential reversals, and smart money positioning.',
            content: `<h2>What is Open Interest in Crypto Futures? Why Traders Should Monitor OI<\/h2><div class="blog-meta"><span class="tag">Market Data<\/span><span>May 3, 2026 · 5 min read<\/span><\/div><p>Open Interest (OI) represents the total number of outstanding derivative contracts — such as futures or options — that have not been settled on an exchange like Binance. Unlike trading volume, which resets every period, OI accumulates and tells you how much capital is actively locked into a market at any given moment. For crypto futures traders, understanding open interest is essential for reading market sentiment and predicting potential price moves.<\/p><h3>Why Open Interest Matters More Than Volume<\/h3><p>Volume tells you how much was traded in the last 24 hours. OI tells you how many positions are still open and at risk. A price rally with rising OI means new money is entering long positions — a strong bullish signal indicating genuine demand. A rally with falling OI suggests a Weak Rally, not genuine buying interest, and the move may reverse quickly once short covering exhausts itself. This distinction is critical for Binance Futures traders who want to avoid getting caught on the wrong side of a fakeout.<\/p><h3>The Four Open Interest Scenarios Matrix By MultiPerps Every Trader Must Know<\/h3><ul><li><strong>Rising Price + Rising OI:<\/strong> Strong trend confirmation. New longs are opening positions and pushing price higher. This is the ideal scenario for trend-following traders — ride the momentum.<\/li><li><strong>Rising Price + Falling OI:<\/strong> Weak trend warning. Shorts are covering their positions, which is temporarily lifting price. Without new buying pressure, this rally is likely unsustainable. Be cautious and consider tightening stops.<\/li><li><strong>Falling Price + Rising OI:<\/strong> Strong downtrend signal. New shorts are entering the market aggressively. Avoid long positions and consider short setups aligned with the dominant bearish flow.<\/li><li><strong>Falling Price + Falling OI:<\/strong> Weak downtrend, potential reversal. Longs are capitulating and closing positions. Once the selling pressure exhausts itself, watch for a reversal setup on your charts.<\/li><\/ul><h3>How to Use Open Interest in Your Crypto Trading Strategy<\/h3><p>Monitor the top OI rankings on MultiPerps to see where the crowd is positioned across Binance USDT-M perpetual contracts. Sudden spikes in open interest before a major news event, economic release, or options expiry often signal an impending volatile move — the market is loading up for a big directional move. Combine OI analysis with funding rates for a complete picture of market sentiment. When OI and funding rates both reach extremes, it often precedes a significant price correction as overcrowded positions get liquidated.<\/p>`
          }, {
            id: 'funding-rates',
            title: 'Crypto Funding Rates Explained: How to Use Them as a Trading Signal',
            date: 'April 28, 2026',
            tag: 'Derivatives',
            keywords: ['funding rate', 'perpetual futures', 'crypto funding', 'Binance funding rate',
              'contrarian trading'
            ],
            hashtags: ['#FundingRates', '#PerpetualFutures', '#CryptoDerivatives', '#BinanceFutures',
              '#ContrarianTrading', '#MarketSentiment', '#MultiPerps'
            ],
            excerpt: 'Funding rates are the heartbeat of perpetual futures markets. Understand how they work, why extreme funding signals trend exhaustion, and how to use them as a contrarian trading indicator.',
            content: `<h2>Crypto Funding Rates Explained: How to Use Them as a Trading Signal<\/h2><div class="blog-meta"><span class="tag">Derivatives<\/span><span>April 28, 2026 · 5 min read<\/span><\/div><p>Perpetual futures contracts on Binance and other exchanges never expire — unlike traditional quarterly futures. To keep the perpetual contract price anchored to the underlying spot market, exchanges use a mechanism called the <strong>funding rate<\/strong>. Every 8 hours (or continuously on some platforms), longs pay shorts — or vice versa — depending on which side of the market is more crowded. Understanding funding rates gives you a powerful edge in reading market sentiment.<\/p><h3>How Funding Rates Work in Practice<\/h3><p>When the perpetual price trades above the spot price, the funding rate turns positive. Long position holders pay short position holders. This discourages excessive bullish leverage and creates a natural equilibrium mechanism. When the perpetual trades below spot, the rate turns negative — shorts pay longs, discouraging excessive bearish leverage. The size of the funding rate is proportional to the premium or discount between perpetual and spot prices.<\/p><h3>Funding Rates as a Contrarian Sentiment Gauge<\/h3><p>Extremely positive funding rates mean the market is heavily long and overleveraged — everyone is piling into the same side of the trade. Historically, this is often a contrarian sell signal, as overcrowded long positions are vulnerable to cascading liquidations when price dips even slightly. Conversely, extremely negative funding means the market is heavily short — a potential buy signal, as forced short covering can produce violent and fast rallies. Smart crypto traders watch funding extremes to time entries against the crowd.<\/p><h3>Trading the Funding Rate Cycle: Actionable Strategies<\/h3><ul><li><strong>High positive funding + price stalling:<\/strong> The market is overleveraged on the long side with no new buying pressure. Consider taking profits on longs or entering short positions with tight stops above the recent high.<\/li><li><strong>High negative funding + price holding support:<\/strong> Shorts are crowded but price is not breaking down — a sign of underlying demand. Look for long opportunities with a stop below the support level.<\/li><li><strong>Funding flipping from extreme positive to negative:<\/strong> A major trend reversal warning. The crowd has been flushed out and sentiment is shifting. This is often the best entry signal for a new directional move.<\/li><\/ul><p>MultiPerps displays the top positive and negative funding rates across all Binance USDT-M perpetual contracts in real time, helping you spot these sentiment extremes before they become mainstream knowledge and the move has already happened.<\/p>`
          }, {
            id: 'MultiPerps-best',
            title: 'Why MultiPerps is the Best Free Crypto Trading Dashboard for Binance Futures (2026)',
            date: 'May 6, 2026',
            tag: 'MultiPerps',
            keywords: ['free crypto dashboard', 'Binance Futures tool', 'crypto trading dashboard', 'MultiPerps',
              'real-time crypto charts', 'free trading tool'
            ],
            hashtags: ['#MultiPerps', '#FreeCryptoTool', '#BinanceFutures', '#CryptoDashboard', '#RealTimeCharts',
              '#PriceAlerts', '#CryptoTrading'
            ],
            excerpt: 'From real-time multi-timeframe charts to live market rankings, price alerts, and open interest tracking — discover why thousands of traders are switching to MultiPerps for their daily Binance Futures analysis.',
          content: `<h2>Why MultiPerps is the Best Free Crypto Trading Dashboard for Binance Futures (2026)</h2>
          <div class="blog-meta"><span class="tag">MultiPerps</span><span>May 6, 2026 · 4 min read</span></div>
          <p>In a sea of cluttered trading dashboards and bloated analytics platforms, MultiPerps stands out as a lightweight, privacy-first, and completely free tool for Binance Futures traders. Here is why thousands of traders rely on it every day for their USDT perpetual contract analysis, and why it should be part of your daily trading workflow in 2026.</p>
          <h3>1. Real-Time Multi-Timeframe Candlestick Charts</h3>
          <p>MultiPerps displays nine timeframes simultaneously — from 1-minute scalping charts to monthly macro analysis. All charts update in real time via direct Binance WebSocket feeds with zero lag. No refresh button needed. Each timeframe includes live RSI indicators and candlestick countdown timers so you always know where you stand in the current candle cycle.</p>
          <h3>2. Live Market Rankings for Binance USDT-M Contracts</h3>
          <p>Track top volume, top gainers, top losers, open interest leaders, and highest/lowest funding rates — all updated live every second. Click any symbol in the rankings to instantly load it into the main multi-chart view. Market discovery and sentiment scanning has never been faster or more intuitive.</p>
          <h3>3. Built-In Price Alerts with Audio Notifications</h3>
          <p>Set up to four price alerts per ticker with audio notifications and visual popups. Alerts persist across browser sessions and trigger reliably while the dashboard is open. No third-party apps, no Telegram bots, no complicated setup — just set your level and focus on your analysis.</p>
          <h3>4. Zero Tracking, Zero Accounts, 100% Privacy</h3>
          <p>Your data stays on your device — period. No login required, no cookies, no analytics trackers, no third-party advertising identifiers. Favorites and alert prices are stored in your browser's localStorage only. Trade with confidence knowing your privacy is fully protected. In an era of data harvesting, MultiPerps respects your right to anonymity.</p>
          <h3>5. Fast, Clean, Mobile-Ready Interface</h3>
          <p>MultiPerps is optimized for speed and responsiveness. It loads in under a second, works smoothly on mobile browsers and tablets, and uses minimal bandwidth. The dark-themed interface is easy on the eyes during long trading sessions and the intuitive layout means zero learning curve.</p>
          <p>Whether you are a day trader scalping 1-minute Bitcoin moves or a swing trader analyzing daily Ethereum structure, MultiPerps gives you the data you need — instantly, privately, and completely free. Start using MultiPerps today and experience the difference a well-designed trading dashboard makes.</p>`
        }
      ];

          const blogModal = document.getElementById('blogModal');
          const blogModalBody = document.getElementById('blogModalBody');
          const blogModalClose = document.getElementById('blogModalClose');
          const blogModalBackdrop = document.getElementById('blogModalBackdrop');

          function renderBlogList() {
            if (!blogModalBody) return;
            let html =
              '<h2 style="color:var(--accent);margin-bottom:18px;font-size:1.3rem;font-weight:800;">📰 Trading Blog<\/h2>';
            html += '<div class="blog-list">';
            for (const blog of blogData) {
              html +=
                `<div class="blog-card" data-blog-id="${blog.id}"><h3>${blog.title}<\/h3><div class="blog-meta"><span class="tag">${blog.tag}<\/span><span>${blog.date}<\/span><\/div><p>${blog.excerpt}<\/p><\/div>`;
            }
            html += '<\/div>';
            blogModalBody.innerHTML = html;
            blogModalBody.querySelectorAll('.blog-card').forEach(card => {
              card.addEventListener('click', () => {
                const id = card.getAttribute('data-blog-id');
                const blog = blogData.find(b => b.id === id);
                if (blog) {
                  blogModalBody.innerHTML =
                    `<button class="blog-back-btn" id="blogBackBtn">← Back to Blog<\/button><div class="blog-detail">${blog.content}<\/div>`;
                  const backBtn = document.getElementById('blogBackBtn');
                  if (backBtn) backBtn.addEventListener('click', renderBlogList);
                }
              });
            });
          }

          function closeBlogModal() {
            if (!blogModal) return;
            blogModal.classList.remove('active');
            document.body.style.overflow = '';
          }
          if (blogModalClose) blogModalClose.addEventListener('click', closeBlogModal);
          if (blogModalBackdrop) blogModalBackdrop.addEventListener('click', closeBlogModal);

// Chart Share Button
          const chartShareBtn = document.getElementById('chartShareBtn');
          const shareModal = document.getElementById('shareModal');
          const shareModalBackdrop = document.getElementById('shareModalBackdrop');
          const shareModalClose = document.getElementById('shareModalClose');
          const shareCopyChartBtn = document.getElementById('shareCopyChartBtn');
          const shareOpenPostBtn = document.getElementById('shareOpenPostBtn');
          const shareStep1Num = document.getElementById('shareStep1Num');
          const shareStep2Num = document.getElementById('shareStep2Num');
          let currentShareText = '';

          function openShareModal() {
            if (!shareModal) return;
            const tickerName = state.symbol.replace('USDT', '');
            currentShareText = `$${tickerName} across all timeframes 👀
\nTrack 9 timeframes at once —  1m • 5m • 15m • 30m • 1h • 4h • 1D • 1W • 1M
\nTry: www.MultiPerps.com
\nFree | No signup
\n#MultiPerps #BinanceFutures \n`;
            if (shareStep1Num) {
              shareStep1Num.textContent = '1';
              shareStep1Num.classList.remove('done');
            }
            if (shareStep2Num) {
              shareStep2Num.textContent = '2';
              shareStep2Num.classList.remove('done');
            }
            if (shareCopyChartBtn) {
              shareCopyChartBtn.textContent = '⧉';
              shareCopyChartBtn.classList.remove('copied');
              shareCopyChartBtn.disabled = false;
            }
            if (shareOpenPostBtn) {
              shareOpenPostBtn.textContent = '⧉';
              shareOpenPostBtn.classList.remove('copied');
              shareOpenPostBtn.disabled = false;
            }
            shareModal.classList.add('active');
            document.body.style.overflow = 'hidden';
          }

          function closeShareModal() {
            if (!shareModal) return;
            shareModal.classList.remove('active');
            document.body.style.overflow = '';
          }
          if (chartShareBtn) {
            chartShareBtn.addEventListener('click', openShareModal);
          }
          if (shareModalClose) shareModalClose.addEventListener('click', closeShareModal);
          if (shareModalBackdrop) shareModalBackdrop.addEventListener('click', closeShareModal);
          if (shareOpenPostBtn) {
            shareOpenPostBtn.addEventListener('click', async () => {
              const ok = await copyText(currentShareText);
              if (ok) {
                shareOpenPostBtn.classList.add('copied');
                shareOpenPostBtn.textContent = '✓';
                if (shareStep2Num) {
                  shareStep2Num.textContent = '✓';
                  shareStep2Num.classList.add('done');
                }
                showToast('Share text copied to clipboard');
                setTimeout(() => {
                  if (shareOpenPostBtn) {
                    shareOpenPostBtn.textContent = '⧉';
                    shareOpenPostBtn.classList.remove('copied');
                  }
                }, 3000);
              }
            });
          }
          if (shareCopyChartBtn) {
            shareCopyChartBtn.addEventListener('click', async () => {
              const chartList = document.querySelector('.chart-list');
              if (!chartList) return;
              try {
                shareCopyChartBtn.textContent = '⏳';
                shareCopyChartBtn.disabled = true;
                if (typeof html2canvas !== 'function') {
                  await new Promise((resolve, reject) => {
                    const script = document.createElement('script');
                    script.src =
                      'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
                    script.crossOrigin = 'anonymous';
                    script.referrerPolicy = 'no-referrer';
                    script.onload = resolve;
                    script.onerror = () => reject(new Error('Failed to load html2canvas'));
                    document.head.appendChild(script);
                  });
                }
                if (typeof html2canvas !== 'function') {
                  throw new Error('html2canvas failed to load');
                }
                const chartListWidth = chartList.offsetWidth;
                const fhdScale = Math.max(2, Math.ceil(1920 / chartListWidth));
                const chartCanvas = await html2canvas(chartList, {
                  backgroundColor: '#0A0C10',
                  scale: fhdScale,
                  useCORS: true,
                  logging: false
                });
                const tickerName = state.symbol.replace('USDT', '');
                const text =
                  `MultiPerps Charts — ${tickerName} multi-timeframe view\n\nwww.MultiPerps.com #MultiPerps #${tickerName}`;
                const textLines = text.split('\n');
                const textFontSize = 28;
                const textPadding = 30;
                const textLineHeight = textFontSize * 1.4;
                const textBlockHeight = textLines.length * textLineHeight + textPadding * 2;
                const compositeCanvas = document.createElement('canvas');
                compositeCanvas.width = chartCanvas.width;
                compositeCanvas.height = chartCanvas.height + textBlockHeight;
                const ctx = compositeCanvas.getContext('2d');
                ctx.fillStyle = '#0A0C10';
                ctx.fillRect(0, 0, compositeCanvas.width, compositeCanvas.height);
                ctx.drawImage(chartCanvas, 0, 0);
                const textFont = `600 ${textFontSize}px 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif`;
                ctx.font = textFont;
                ctx.textAlign = 'center';
                const textY0 = chartCanvas.height + textPadding + textLineHeight;
                const beforeTicker = 'MultiPerps Charts — ';
                const afterTicker = ' multi-timeframe view';
                const beforeWidth = ctx.measureText(beforeTicker).width;
                const tickerWidth = ctx.measureText(tickerName).width;
                const afterWidth = ctx.measureText(afterTicker).width;
                const totalWidth = beforeWidth + tickerWidth + afterWidth;
                const startX = (compositeCanvas.width - totalWidth) / 2;
                ctx.textAlign = 'left';
                ctx.fillStyle = '#CDD7E1';
                ctx.fillText(beforeTicker, startX, textY0);
                ctx.fillStyle = '#F3A052';
                ctx.fillText(tickerName, startX + beforeWidth, textY0);
                ctx.fillStyle = '#CDD7E1';
                ctx.fillText(afterTicker, startX + beforeWidth + tickerWidth, textY0);
                ctx.textAlign = 'left';
                for (let i = 1; i < textLines.length; i++) {
                  const yPos = chartCanvas.height + textPadding + (i + 1) * textLineHeight;
                  const lineText = textLines[i];
                  if (lineText.includes('#MultiPerps')) {
                    const hashPrefix = 'www.MultiPerps.com #MultiPerps ';
                    const hashTicker = '#' + tickerName;
                    const prefixWidth = ctx.measureText(hashPrefix).width;
                    const tickerHashWidth = ctx.measureText(hashTicker).width;
                    const totalW = prefixWidth + tickerHashWidth;
                    const sx = (compositeCanvas.width - totalW) / 2;
                    ctx.fillStyle = '#CDD7E1';
                    ctx.fillText(hashPrefix, sx, yPos);
                    ctx.fillStyle = '#F3A052';
                    ctx.fillText(hashTicker, sx + prefixWidth, yPos);
                  } else {
                    ctx.textAlign = 'center';
                    ctx.fillStyle = '#CDD7E1';
                    ctx.fillText(lineText, compositeCanvas.width / 2, yPos);
                    ctx.textAlign = 'left';
                  }
                }
                compositeCanvas.toBlob(async (blob) => {
                  if (!blob) {
                    throw new Error('Canvas toBlob failed');
                  }
                  try {
                    await navigator.clipboard.write([new ClipboardItem({
                      'image/png': blob
                    })]);
                    shareCopyChartBtn.classList.add('copied');
                    shareCopyChartBtn.textContent = '✓';
                    if (shareStep1Num) {
                      shareStep1Num.textContent = '✓';
                      shareStep1Num.classList.add('done');
                    }
                  } catch {
                    try {
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url;
                      a.download = 'MultiPerps-charts.png';
                      a.click();
                      URL.revokeObjectURL(url);
                      shareCopyChartBtn.classList.add('copied');
                      shareCopyChartBtn.textContent = '✓';
                      if (shareStep1Num) {
                        shareStep1Num.textContent = '✓';
                        shareStep1Num.classList.add('done');
                      }
                    } catch {
                      shareCopyChartBtn.textContent = '✗';
                    }
                  }
                  shareCopyChartBtn.disabled = false;
                  setTimeout(() => {
                    if (shareCopyChartBtn) {
                      shareCopyChartBtn.textContent = '⧉';
                      shareCopyChartBtn.classList.remove('copied');
                    }
                  }, 4000);
                }, 'image/png');
              } catch (err) {
                console.error('Chart capture failed:', err);
                shareCopyChartBtn.textContent = '✗';
                shareCopyChartBtn.disabled = false;
                setTimeout(() => {
                  if (shareCopyChartBtn) {
                    shareCopyChartBtn.textContent = '⧉';
                    shareCopyChartBtn.classList.remove('copied');
                  }
                }, 2000);
              }
            });
          }
          const pageContents = {
        about: `<h2>About MultiPerps</h2>
          <div class="modal-section"><p>MultiPerps is a free, real-time Binance Futures dashboard built for crypto traders who need clean, fast market data for USDT perpetual contracts. We provide live price tracking, multi-timeframe candlestick charts with RSI indicators, the Multi OI indicator that reveals what's happening beneath price action by analyzing open interest and price together, and comprehensive market rankings — all in your browser with zero installation and zero sign-up. So, our slogan is "MultiPerps — All Timeframes. All Free."</p></div>
          <div class="modal-section"><p>Our mission is to deliver institutional-grade data visualization in a lightweight, privacy-focused package. No accounts, no tracking, no bloat. Whether you trade Bitcoin, Ethereum, Solana, or any of the 200+ USDT-M perpetual futures on Binance, MultiPerps gives you the edge you need to make informed trading decisions.</p></div>
          <div class="modal-section"><p>MultiPerps supports nine real-time chart timeframes (1m, 5m, 15m, 30m, 1h, 4h, 1d, 1w, 1M), the Multi OI indicator (classifies market conditions into four clear scenarios — Strong Uptrend, Weak Rally, Strong Downtrend, and Exhaustion — across 30m, 1H, and 4H timeframes, with a Composite Signal Score), live market rankings for volume, gainers, losers, open interest, and funding rates, plus multi-type alerts with audio notifications — set price alerts or funding rate alerts across up to four slots — all powered by direct Binance WebSocket feeds for zero-latency data delivery.</p></div>`,
        disclaimer: `<h2>Disclaimer</h2>
          <div class="modal-section"><p>This dashboard is provided for informational purposes only and does not constitute financial advice. Cryptocurrency futures trading carries substantial risk of loss.</p></div>
          <div class="modal-section"><p>MultiPerps is not responsible for any trading decisions made based on data displayed. Prices are sourced from Binance public APIs and may experience delays. Always verify critical data on official exchange platforms before executing trades.</p></div>`,
        terms: `<h2>Terms of Use</h2>
          <div class="modal-section"><p>By accessing MultiPerps, you agree to use this tool lawfully and responsibly. All data is sourced from third-party public APIs and is provided "as is" without warranties of any kind.</p></div>
          <div class="modal-section"><p>You may not scrape, automate, or redistribute data obtained through this interface at scale. We reserve the right to modify or discontinue the service at any time without notice.</p></div>`,
        privacy: `<h2>Privacy Policy</h2>
          <div class="modal-section"><p>MultiPerps does not collect, store, or transmit any personal information. All preferences — including favorite tickers, alert prices, and symbol history — are stored locally in your browser via localStorage.</p></div>
          <div class="modal-section"><p>We do not use cookies, analytics trackers, or third-party advertising identifiers. Your data never leaves your device.</p></div>`,
        alerts: `<h2>Dashboard Alerts</h2>
          <div class="modal-section"><p>Set alerts directly on the dashboard — choose from two alert types per slot. <strong>Price alerts</strong> fire when the market price crosses your specified level. <strong>Funding Rate alerts</strong> fire when the perpetual funding rate crosses your threshold in either direction.</p></div>
          <div class="modal-section"><p>When the current value crosses your threshold (above or below), MultiPerps triggers an audio notification and a visual popup. All alert types use the same reliable cross-detection logic with a 3-second cooldown to prevent duplicate spam after each trigger.</p></div>
          <div class="modal-section"><p>Alert thresholds are saved per symbol in your browser's local storage, so they persist between sessions. Each of the four alert slots supports any alert type — mix and match as needed.</p></div>
          <div class="modal-section"><p><strong>Note:</strong> Alerts work even when this browser tab is in the background. Keep the tab open (not closed) to receive alerts.</p></div>`,
        usdt: `<h2>Donation</h2>
          <div class="modal-section"><p>Support MultiPerps development with a USDT donation on BNB Smart Chain (BSC / BEP-20).</p></div>
          <div class="modal-section">
            <div class="donation-box" style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;justify-content:space-between;">
              <span style="word-break:break-all;font-family:monospace;font-size:0.9rem;">0xf3b9080c6712f17d2b5af235f4dd16c2fc9c40fb</span>
              <button class="copy-price-btn donation-copy-btn" data-copy="0xf3b9080c6712f17d2b5af235f4dd16c2fc9c40fb" type="button" title="Copy address to clipboard" style="flex-shrink:0;">⧉</button>
            </div>
          </div>`
          };
          const pageModal = document.getElementById('pageModal');
          const pageModalBody = document.getElementById('pageModalBody');
          const pageModalClose = document.getElementById('pageModalClose');
          const pageModalBackdrop = document.getElementById('pageModalBackdrop');

          function openPage(page) {
            const content = pageContents[page];
            if (!content || !pageModal || !pageModalBody) return;
            pageModalBody.innerHTML = content;
            pageModal.classList.add('active');
            document.body.style.overflow = 'hidden';
          }
          if (pageModalBody) {
            pageModalBody.addEventListener('click', async (e) => {
              const btn = e.target.closest('.donation-copy-btn');
              if (!btn) return;
              const text = btn.getAttribute('data-copy');
              if (!text) return;
              const ok = await copyText(text);
              btn.classList.add('copied');
              btn.textContent = ok ? 'Copied' : 'Failed';
              setTimeout(() => {
                btn.classList.remove('copied');
                btn.textContent = '⧉';
              }, 1200);
            });
          }

          function closePage() {
            if (!pageModal) return;
            pageModal.classList.remove('active');
            document.body.style.overflow = '';
          }
          document.querySelectorAll('.footer-col a[data-page]').forEach(link => {
            link.addEventListener('click', (e) => {
              e.preventDefault();
              const page = link.getAttribute('data-page');
              if (page) {
                openPage(page);
              }
            });
          });
          if (pageModalClose) pageModalClose.addEventListener('click', closePage);
          if (pageModalBackdrop) pageModalBackdrop.addEventListener('click', closePage);
        };
        const handleNetworkOffline = () => {
          state.wsStatus = {
            text: 'Offline',
            level: 'error'
          };
          updateStatus();
          oiPricePanel.stopAutoRefresh();
          clearReconnectTimer();
          if (state.rankings.reconnectTimer) {
            clearTimeout(state.rankings.reconnectTimer);
            state.rankings.reconnectTimer = null;
          }
          if (state.ws) {
            try {
              state.ws.onclose = null;
              state.ws.onerror = null;
              state.ws.onmessage = null;
              state.ws.close();
            } catch {}
            state.ws = null;
          }
          closeSecondaryWs();
          if (state.rankings.ws) {
            try {
              state.rankings.ws.onclose = null;
              state.rankings.ws.onerror = null;
              state.rankings.ws.onmessage = null;
              state.rankings.ws.close();
            } catch {}
            state.rankings.ws = null;
          }
          renderAlertLiveStatus();
        };
        const handleNetworkOnline = async () => {
          state.wsStatus = {
            text: 'Reconnecting...',
            level: 'connecting'
          };
          updateStatus();
          state.reconnectAttempts = 0;
          state.secondaryReconnectAttempts = 0;
          state.rankings.wsGeneration += 1;
          state.rankings.reconnectAttempts = 0;
          clearReconnectTimer();
          if (state.rankings.reconnectTimer) {
            clearTimeout(state.rankings.reconnectTimer);
            state.rankings.reconnectTimer = null;
          }
          state._skipReconnectKlineRefresh = true;
          connectBinanceFutures();
          state.rankings._wasConnected = false;
          connectRankingsWebSocket();
          fetchCurrentPrice(state.symbol).catch(() => {});
          try {
            await Promise.all(CONFIG.INTERVALS.map(async (interval) => {
              const chart = state.charts[interval];
              if (!chart) return;
              try {
                chart.candles = await fetchExchangeKlines(state.symbol, interval, CONFIG.KLINE_LIMIT);
              } catch {}
              chart.dirty = true;
            }));
            updateChartMetas();
            redrawCharts();
          } catch {}
          try {
            await Promise.all([fetchRankingsData(), fetchFundingRates()]);
            renderAllRankings();
          } catch {}
          if (state._alertMonitorRunning && state.multiAlerts.some(a => a && a.ticker && (Number.isFinite(a
              .threshold) || Number.isFinite(a.price)))) {
            renderAlertLiveStatus();
          }
          const activeTrackerSymbols = stateTracker.symbols.filter(Boolean);
          if (activeTrackerSymbols.length > 0) {
            try {
              await fetchTrackerKlines();
            } catch {}
          }
          // Restart OI panel auto-refresh after reconnect
          if (oiPricePanel.symbol && state.isRunning) {
            oiPricePanel.startAutoRefresh(oiPricePanel.symbol);
          }
        };
        window.addEventListener('offline', handleNetworkOffline);
        window.addEventListener('online', handleNetworkOnline);
        window.addEventListener('error', (event) => {
          console.error('Global error:', event.message, event.filename, event.lineno);
        });
        window.addEventListener('unhandledrejection', (event) => {
          console.error('Unhandled promise rejection:', event.reason);
          if (event.reason && typeof event.reason === 'object' && event.reason.message) {
            const msg = event.reason.message;
            if (msg.includes('Failed to fetch') || msg.includes('NetworkError') || msg.includes('HTTP 4')) {
              return;
            }
            showToast('Error', msg.slice(0, 100), 'down');
          }
        });
        if (document.readyState === 'loading') {
          document.addEventListener('DOMContentLoaded', () => {
            initUI();
            loadSymbol(state.symbol).then(() => {
              revealFooter();
            });
          });
        } else {
          initUI();
          loadSymbol(state.symbol).then(() => {
            revealFooter();
          });
        }

        function revealFooter() {
          requestAnimationFrame(() => {
            const footer = document.querySelector('.site-footer');
            if (footer) footer.classList.add('loaded');
          });
        }