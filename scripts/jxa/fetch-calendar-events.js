/**
 * macOS「カレンダー」アプリからイベントを JSON で出力する（JXA）。
 * 実行: osascript -l JavaScript scripts/jxa/fetch-calendar-events.js /path/to/config.json
 *
 * 初回は「システム設定 → プライバシーとセキュリティ → 自動化」で
 * ターミナル（または Node）がカレンダーを操作できるように許可が必要な場合があります。
 */

function run(argv) {
  ObjC.import('Foundation');

  var configPath = argv[0];
  if (!configPath) {
    return JSON.stringify({ ok: false, error: 'config path required' });
  }

  var nsStr = $.NSString.stringWithContentsOfFileEncodingError(
    configPath,
    $.NSUTF8StringEncoding,
    null
  );
  if (!nsStr) {
    return JSON.stringify({ ok: false, error: 'failed to read config: ' + configPath });
  }

  var config;
  try {
    config = JSON.parse(ObjC.unwrap(nsStr));
  } catch (e) {
    return JSON.stringify({ ok: false, error: 'invalid JSON in config' });
  }

  var lookBack = config.lookBackDays != null ? Number(config.lookBackDays) : 30;
  var lookAhead = config.lookAheadDays != null ? Number(config.lookAheadDays) : 120;
  var now = Date.now();
  var start = new Date(now - lookBack * 86400000);
  var end = new Date(now + lookAhead * 86400000);

  var calendarNames = config.calendars || [];
  if (calendarNames.length === 0) {
    return JSON.stringify({ ok: true, events: [] });
  }

  try {
    var app = Application('Calendar');
    var out = [];

    for (var c = 0; c < calendarNames.length; c++) {
      var calName = calendarNames[c];
      var found = null;
      var allCalendars = app.calendars();
      for (var i = 0; i < allCalendars.length; i++) {
        if (allCalendars[i].name() === calName) {
          found = allCalendars[i];
          break;
        }
      }
      if (!found) {
        continue;
      }

      var evs = found.events();
      for (var j = 0; j < evs.length; j++) {
        var e = evs[j];
        var sd = e.startDate();
        if (!sd || sd < start || sd > end) {
          continue;
        }
        var uid = '';
        try {
          uid = e.uid();
        } catch (err) {
          uid = '';
        }
        if (!uid) {
          try {
            uid = String(e.id());
          } catch (err2) {
            uid = 'row-' + j + '-' + sd.getTime();
          }
        }

        var summary = '';
        try {
          summary = e.summary();
        } catch (se) {
          summary = '';
        }

        var desc = '';
        try {
          desc = e.description();
        } catch (de) {
          desc = '';
        }

        out.push({
          calendar: calName,
          uid: String(uid),
          summary: summary || '',
          startDate: sd.toISOString(),
          description: desc || ''
        });
      }
    }

    return JSON.stringify({ ok: true, events: out });
  } catch (ex) {
    return JSON.stringify({
      ok: false,
      error: ex instanceof Error ? ex.message : String(ex)
    });
  }
}
