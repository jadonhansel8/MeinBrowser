#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::Mutex;

use serde::Serialize;
use tauri::{
    webview::{NewWindowResponse, WebviewBuilder},
    window::WindowBuilder,
    AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, State, Url, WebviewUrl, WindowEvent,
};

// Bereich (x, y, Breite, Höhe) in dem die Seiten-Tabs angezeigt werden.
// Die Oberfläche (index.html) meldet ihn über den Befehl "layout".
struct Layout(Mutex<[f64; 4]>);

#[derive(Clone, Serialize)]
struct TabEvent {
    id: u32,
    value: String,
}

fn label(id: u32) -> String {
    format!("tab-{id}")
}

fn apply_layout(app: &AppHandle, l: [f64; 4]) {
    for (name, wv) in app.webviews() {
        if name.starts_with("tab-") {
            let _ = wv.set_position(LogicalPosition::new(l[0], l[1]));
            let _ = wv.set_size(LogicalSize::new(l[2], l[3]));
        }
    }
}

fn show_only(app: &AppHandle, id: u32) {
    let me = label(id);
    for (name, wv) in app.webviews() {
        if name.starts_with("tab-") {
            if name == me {
                let _ = wv.show();
            } else {
                let _ = wv.hide();
            }
        }
    }
}

// async, damit das Erstellen von Webviews unter Windows nicht blockiert
#[tauri::command]
async fn tab_new(app: AppHandle, layout: State<'_, Layout>, id: u32, url: String) -> Result<(), String> {
    let window = app.get_window("main").ok_or("Hauptfenster fehlt")?;
    let l = *layout.0.lock().unwrap();

    let target = if url == "app:start" {
        WebviewUrl::App("start.html".into())
    } else {
        WebviewUrl::External(url.parse::<Url>().map_err(|e| e.to_string())?)
    };

    let (a, b, c) = (app.clone(), app.clone(), app.clone());
    let builder = WebviewBuilder::new(label(id), target)
        .on_page_load(move |_wv, p| {
            let _ = a.emit("tab-url", TabEvent { id, value: p.url().to_string() });
        })
        .on_document_title_changed(move |_wv, title| {
            let _ = b.emit("tab-title", TabEvent { id, value: title });
        })
        .on_new_window(move |url, _features| {
            // Links mit target=_blank / window.open -> neuer Tab in der Oberfläche
            let _ = c.emit("tab-open", url.to_string());
            NewWindowResponse::Deny
        });

    window
        .add_child(
            builder,
            LogicalPosition::new(l[0], l[1]),
            LogicalSize::new(l[2].max(100.0), l[3].max(100.0)),
        )
        .map_err(|e| e.to_string())?;
    show_only(&app, id);
    Ok(())
}

#[tauri::command]
fn tab_show(app: AppHandle, id: u32) {
    show_only(&app, id);
}

#[tauri::command]
fn tab_close(app: AppHandle, id: u32) {
    if let Some(wv) = app.get_webview(&label(id)) {
        let _ = wv.close();
    }
}

#[tauri::command]
fn tab_navigate(app: AppHandle, id: u32, url: String) -> Result<(), String> {
    let wv = app.get_webview(&label(id)).ok_or("Tab nicht gefunden")?;
    wv.navigate(url.parse::<Url>().map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn tab_action(app: AppHandle, id: u32, action: String, arg: Option<String>) -> Result<(), String> {
    let wv = app.get_webview(&label(id)).ok_or("Tab nicht gefunden")?;
    let arg = arg.unwrap_or_default();
    let js_arg = serde_json::to_string(&arg).unwrap_or_else(|_| "\"\"".into());
    let r: tauri::Result<()> = match action.as_str() {
        "back" => wv.eval("history.back()"),
        "forward" => wv.eval("history.forward()"),
        "reload" => wv.eval("location.reload()"),
        "devtools" => {
            wv.open_devtools();
            Ok(())
        }
        "zoom" => wv.set_zoom(arg.parse().unwrap_or(1.0)),
        "find" | "findnext" => wv.eval(&format!("window.find({js_arg}, false, false, true)")),
        "clearfind" => wv.eval("window.getSelection().removeAllRanges()"),
        _ => Ok(()),
    };
    r.map_err(|e| e.to_string())
}

#[tauri::command]
fn layout(app: AppHandle, state: State<Layout>, x: f64, y: f64, w: f64, h: f64) {
    let l = [x, y, w.max(100.0), h.max(100.0)];
    *state.0.lock().unwrap() = l;
    apply_layout(&app, l);
}

#[tauri::command]
fn clear_data(app: AppHandle) -> Result<(), String> {
    let wv = app.get_webview("ui").ok_or("Oberfläche nicht gefunden")?;
    wv.clear_all_browsing_data().map_err(|e| e.to_string())
}

fn main() {
    tauri::Builder::default()
        .manage(Layout(Mutex::new([52.0, 90.0, 900.0, 600.0])))
        .setup(|app| {
            let window = WindowBuilder::new(app, "main")
                .title("MeinBrowser")
                .inner_size(1280.0, 800.0)
                .build()?;

            let size = window.inner_size()?.to_logical::<f64>(window.scale_factor()?);
            window.add_child(
                WebviewBuilder::new("ui", WebviewUrl::App("index.html".into())),
                LogicalPosition::new(0.0, 0.0),
                size,
            )?;

            // Oberfläche füllt immer das ganze Fenster; die Tabs passt index.html über "layout" an
            let w = window.clone();
            window.on_window_event(move |e| {
                if let WindowEvent::Resized(_) = e {
                    if let (Some(ui), Ok(s), Ok(sf)) =
                        (w.app_handle().get_webview("ui"), w.inner_size(), w.scale_factor())
                    {
                        let _ = ui.set_size(s.to_logical::<f64>(sf));
                    }
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            tab_new, tab_show, tab_close, tab_navigate, tab_action, layout, clear_data
        ])
        .run(tauri::generate_context!())
        .expect("Fehler beim Starten von MeinBrowser");
}
