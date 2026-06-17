use serde::{Serialize, Deserialize};
use std::collections::{HashMap, HashSet};
use std::sync::Mutex;
use std::fs;
use std::time::{Duration, Instant};
use std::net::UdpSocket;
use tauri::{Manager, Emitter};
#[cfg(desktop)]
use tauri::menu::{Menu, MenuItem};
#[cfg(desktop)]
use tauri::tray::{TrayIconBuilder, TrayIconEvent};
use tauri_plugin_notification::NotificationExt;

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct AppSettings {
    #[serde(rename = "minimize_to_tray")]
    pub minimize_to_tray: bool,
    #[serde(rename = "refresh_interval")]
    pub refresh_interval: u32,
    #[serde(rename = "disable_notifications")]
    pub disable_notifications: bool,
    #[serde(rename = "close_to_tray")]
    pub close_to_tray: bool,
}

fn default_settings() -> AppSettings {
    AppSettings {
        minimize_to_tray: false,
        refresh_interval: 30,
        disable_notifications: false,
        close_to_tray: true,
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Server {
    pub name: String,
    pub addr: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct PlayerInfo {
    pub name: String,
    pub score: String,
    pub ping: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ServerQueryInfo {
    pub map_name: String,
    pub max_clients: i32,
    pub hostname: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct QueryResult {
    pub players: Vec<PlayerInfo>,
    pub server_info: Option<ServerQueryInfo>,
    pub ping: i32,
    pub is_online: bool,
    pub error: Option<String>,
}

pub struct AppState {
    pub settings: AppSettings,
    pub servers: Vec<Server>,
    pub player_tracker: HashMap<String, HashSet<String>>, // server_addr -> set of player names
    pub tracker_initialized: HashSet<String>, // server_addr is initialized
}

#[tauri::command]
fn get_settings(state: tauri::State<'_, Mutex<AppState>>) -> AppSettings {
    state.lock().unwrap().settings.clone()
}

#[tauri::command]
fn save_settings(
    settings: AppSettings,
    state: tauri::State<'_, Mutex<AppState>>,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    let mut s = state.lock().unwrap();
    s.settings = settings.clone();
    
    let path = app_handle.path().app_data_dir().map_err(|e| e.to_string())?.join("settings.json");
    let file = fs::File::create(&path).map_err(|e| e.to_string())?;
    serde_json::to_writer_pretty(file, &settings).map_err(|e| e.to_string())?;
    
    Ok(())
}

#[tauri::command]
fn get_servers(state: tauri::State<'_, Mutex<AppState>>) -> Vec<Server> {
    state.lock().unwrap().servers.clone()
}

#[tauri::command]
fn add_server(
    name: String,
    addr: String,
    state: tauri::State<'_, Mutex<AppState>>,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    let mut s = state.lock().unwrap();
    let normalized_addr = normalize_server_addr(&addr);
    s.servers.push(Server {
        name,
        addr: normalized_addr,
    });
    
    let servers = s.servers.clone();
    let path = app_handle.path().app_data_dir().map_err(|e| e.to_string())?.join("servers.json");
    let file = fs::File::create(&path).map_err(|e| e.to_string())?;
    serde_json::to_writer_pretty(file, &servers).map_err(|e| e.to_string())?;
    
    Ok(())
}

#[tauri::command]
fn delete_server(
    addr: String,
    state: tauri::State<'_, Mutex<AppState>>,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    let mut s = state.lock().unwrap();
    s.servers.retain(|srv| srv.addr != addr);
    s.player_tracker.remove(&addr);
    s.tracker_initialized.remove(&addr);
    
    let servers = s.servers.clone();
    let path = app_handle.path().app_data_dir().map_err(|e| e.to_string())?.join("servers.json");
    let file = fs::File::create(&path).map_err(|e| e.to_string())?;
    serde_json::to_writer_pretty(file, &servers).map_err(|e| e.to_string())?;
    
    Ok(())
}

#[tauri::command]
async fn query_server(addr: String) -> QueryResult {
    tauri::async_runtime::spawn_blocking(move || {
        query_quake2_server(&addr)
    }).await.unwrap_or_else(|e| QueryResult {
        players: Vec::new(),
        server_info: None,
        ping: 0,
        is_online: false,
        error: Some(format!("Task panic: {}", e)),
    })
}

fn normalize_server_addr(addr: &str) -> String {
    if addr.is_empty() {
        return addr.to_string();
    }
    if !addr.contains(':') {
        format!("{}:27910", addr)
    } else {
        addr.to_string()
    }
}

pub fn query_quake2_server(addr: &str) -> QueryResult {
    let start_time = Instant::now();
    let socket = match UdpSocket::bind("0.0.0.0:0") {
        Ok(s) => s,
        Err(e) => return QueryResult {
            players: Vec::new(),
            server_info: None,
            ping: 0,
            is_online: false,
            error: Some(format!("Failed to bind UDP socket: {}", e)),
        },
    };

    if let Err(e) = socket.set_read_timeout(Some(Duration::from_millis(2000))) {
        return QueryResult {
            players: Vec::new(),
            server_info: None,
            ping: 0,
            is_online: false,
            error: Some(format!("Failed to set read timeout: {}", e)),
        };
    }

    if let Err(e) = socket.connect(addr) {
        return QueryResult {
            players: Vec::new(),
            server_info: None,
            ping: 0,
            is_online: false,
            error: Some(format!("Failed to connect: {}", e)),
        };
    }

    let req = b"\xff\xff\xff\xffstatus\x00";
    if let Err(e) = socket.send(req) {
        return QueryResult {
            players: Vec::new(),
            server_info: None,
            ping: 0,
            is_online: false,
            error: Some(format!("Failed to send query: {}", e)),
        };
    }

    let mut buf = [0u8; 4096];
    let n = match socket.recv(&mut buf) {
        Ok(bytes) => bytes,
        Err(e) => return QueryResult {
            players: Vec::new(),
            server_info: None,
            ping: start_time.elapsed().as_millis() as i32,
            is_online: false,
            error: Some(format!("Failed to read response: {}", e)),
        },
    };

    let ping = start_time.elapsed().as_millis() as i32;
    let response = String::from_utf8_lossy(&buf[..n]);

    let parts: Vec<&str> = response.split('\\').collect();
    if parts.len() < 2 {
        return QueryResult {
            players: Vec::new(),
            server_info: None,
            ping,
            is_online: false,
            error: Some("Invalid response format".to_string()),
        };
    }

    if !parts[0].contains("print") {
        return QueryResult {
            players: Vec::new(),
            server_info: None,
            ping,
            is_online: false,
            error: Some("Response does not contain print header".to_string()),
        };
    }

    let mut map_name = String::new();
    let mut max_clients = 0;
    let mut hostname = String::new();
    let mut players_text = "";

    let mut i = 1;
    while i < parts.len() {
        if i + 1 >= parts.len() {
            break;
        }
        let key = parts[i];
        let val_part = parts[i+1];

        if val_part.contains('\n') {
            if let Some(idx) = val_part.find('\n') {
                let val = &val_part[..idx];
                set_server_info_field(key, val, &mut map_name, &mut max_clients, &mut hostname);
                players_text = &val_part[idx+1..];
            }
            break;
        }

        set_server_info_field(key, val_part, &mut map_name, &mut max_clients, &mut hostname);
        i += 2;
    }

    let players = parse_player_list(players_text);

    QueryResult {
        players,
        server_info: Some(ServerQueryInfo {
            map_name,
            max_clients,
            hostname,
        }),
        ping,
        is_online: true,
        error: None,
    }
}

fn set_server_info_field(key: &str, val: &str, map_name: &mut String, max_clients: &mut i32, hostname: &mut String) {
    match key {
        "mapname" => *map_name = val.to_string(),
        "maxclients" => {
            if let Ok(parsed) = val.parse::<i32>() {
                *max_clients = parsed;
            }
        }
        "hostname" => *hostname = val.to_string(),
        _ => {}
    }
}

fn parse_player_list(players_text: &str) -> Vec<PlayerInfo> {
    let mut players = Vec::new();
    if players_text.is_empty() {
        return players;
    }

    for line in players_text.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        let parts: Vec<&str> = trimmed.split_whitespace().collect();
        if parts.len() >= 3 {
            let score = parts[0].to_string();
            let ping = parts[1].to_string();
            
            let name = if let Some(first_quote) = trimmed.find('"') {
                if let Some(last_quote) = trimmed.rfind('"') {
                    if first_quote != last_quote {
                        trimmed[first_quote+1..last_quote].to_string()
                    } else {
                        trimmed[first_quote+1..].to_string()
                    }
                } else {
                    trimmed[first_quote+1..].to_string()
                }
            } else {
                parts[2..].join(" ")
            };

            players.push(PlayerInfo { name, score, ping });
        }
    }

    players
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            let app_data_dir = app.path().app_data_dir().unwrap();
            if !app_data_dir.exists() {
                let _ = fs::create_dir_all(&app_data_dir);
            }
            
            let settings_path = app_data_dir.join("settings.json");
            let settings = if settings_path.exists() {
                fs::File::open(&settings_path)
                    .ok()
                    .and_then(|file| serde_json::from_reader(file).ok())
                    .unwrap_or_else(default_settings)
            } else {
                let def = default_settings();
                if let Ok(file) = fs::File::create(&settings_path) {
                    let _ = serde_json::to_writer_pretty(file, &def);
                }
                def
            };

            let servers_path = app_data_dir.join("servers.json");
            let mut servers: Vec<Server> = if servers_path.exists() {
                fs::File::open(&servers_path)
                    .ok()
                    .and_then(|file| serde_json::from_reader(file).ok())
                    .unwrap_or_default()
            } else {
                Vec::new()
            };

            if servers.is_empty() {
                servers.push(Server {
                    name: "sh".to_string(),
                    addr: "124.222.155.27:27910".to_string(),
                });
                servers.push(Server {
                    name: "#1".to_string(),
                    addr: "122.51.208.104:27910".to_string(),
                });
                if let Ok(file) = fs::File::create(&servers_path) {
                    let _ = serde_json::to_writer_pretty(file, &servers);
                }
            }

            let state = AppState {
                settings,
                servers,
                player_tracker: HashMap::new(),
                tracker_initialized: HashSet::new(),
            };
            app.manage(Mutex::new(state));
            
            #[cfg(desktop)]
            {
                let show_i = MenuItem::with_id(app, "show", "显示窗口", true, None::<&str>)?;
                let hide_i = MenuItem::with_id(app, "hide", "隐藏窗口", true, None::<&str>)?;
                let quit_i = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
                let menu = Menu::with_items(app, &[&show_i, &hide_i, &quit_i])?;

                let _tray = TrayIconBuilder::new()
                    .icon(app.default_window_icon().unwrap().clone())
                    .menu(&menu)
                    .on_menu_event(|app, event| match event.id.as_ref() {
                        "show" => {
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                        "hide" => {
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.hide();
                            }
                        }
                        "quit" => {
                            app.exit(0);
                        }
                        _ => {}
                    })
                    .on_tray_icon_event(|tray, event| {
                        if let TrayIconEvent::Click { 
                            button: tauri::tray::MouseButton::Left, 
                            button_state: tauri::tray::MouseButtonState::Up, 
                            .. 
                        } = event {
                            let app = tray.app_handle();
                            if let Some(window) = app.get_webview_window("main") {
                                let is_visible = window.is_visible().unwrap_or(false);
                                let is_minimized = window.is_minimized().unwrap_or(false);
                                if is_visible && !is_minimized {
                                    let _ = window.hide();
                                } else {
                                    if is_minimized {
                                        let _ = window.unminimize();
                                    }
                                    let _ = window.show();
                                    let _ = window.set_focus();
                                }
                            }
                        }
                    })
                    .build(app)?;
            }

            let window = app.get_webview_window("main").unwrap();
            let window_ = window.clone();
            let app_handle = app.handle().clone();
            window.on_window_event(move |event| {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    let state_lock = app_handle.state::<Mutex<AppState>>();
                    let close_to_tray = state_lock.lock().unwrap().settings.close_to_tray;
                    if close_to_tray {
                        api.prevent_close();
                        let _ = window_.hide();
                    }
                }
            });

            let app_handle_bg = app.handle().clone();
            std::thread::spawn(move || {
                let state_bg = app_handle_bg.state::<Mutex<AppState>>();
                let mut last_run = Instant::now() - Duration::from_secs(3600);
                loop {
                    let (interval, disable_notifications, servers) = {
                        let s = state_bg.lock().unwrap();
                        (s.settings.refresh_interval, s.settings.disable_notifications, s.servers.clone())
                    };

                    if interval > 0 {
                        let elapsed = last_run.elapsed().as_secs();
                        if elapsed >= interval as u64 {
                            last_run = Instant::now();
                            
                            for server in servers {
                                let res = query_quake2_server(&server.addr);
                                
                                let (initialized, prev_players) = {
                                    let mut s = state_bg.lock().unwrap();
                                    let initialized = s.tracker_initialized.contains(&server.addr);
                                    let prev_players = s.player_tracker.entry(server.addr.clone()).or_insert_with(HashSet::new).clone();
                                    (initialized, prev_players)
                                };
                                
                                let mut current_names = HashSet::new();
                                for player in &res.players {
                                    current_names.insert(player.name.clone());
                                    if !prev_players.contains(&player.name) && initialized && !disable_notifications {
                                        let title = format!("{} ({})", server.name, server.addr);
                                        let body = format!("{} 上线了", player.name);
                                        let _ = app_handle_bg.notification()
                                            .builder()
                                            .title(title)
                                            .body(body)
                                            .icon("ic_notification")
                                            .large_icon("ic_notification")
                                            .show();
                                    }
                                }
                                
                                {
                                    let mut s = state_bg.lock().unwrap();
                                    s.player_tracker.insert(server.addr.clone(), current_names);
                                    s.tracker_initialized.insert(server.addr.clone());
                                }
                                
                                #[derive(Serialize, Clone)]
                                struct UpdatePayload {
                                    addr: String,
                                    result: QueryResult,
                                }
                                let _ = app_handle_bg.emit("server-status-updated", UpdatePayload {
                                    addr: server.addr,
                                    result: res,
                                });
                            }
                        }
                    }
                    std::thread::sleep(Duration::from_secs(1));
                }
            });

            let state_lock = app.state::<Mutex<AppState>>();
            let minimize_to_tray = state_lock.lock().unwrap().settings.minimize_to_tray;
            if minimize_to_tray {
                let _ = window.hide();
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_settings,
            save_settings,
            get_servers,
            add_server,
            delete_server,
            query_server
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
