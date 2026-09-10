; Inno Setup 脚本 — 把 PyInstaller onedir 产物 dist\QuickModel\ 打包成 QuickModel-Setup.exe
; 版本号由 CI 传入：iscc /DMyAppVersion=1.8.3 installer.iss
#ifndef MyAppVersion
  #define MyAppVersion "0.0.0"
#endif

[Setup]
; AppId 固定 GUID —— 覆盖安装靠它识别为同一应用，勿改
AppId={{8F3A1C74-2B9E-4D5A-9C21-6E7B0F4A2D31}
AppName=QuickModel
AppVersion={#MyAppVersion}
AppPublisher=SolitudeZY
DefaultDirName={autopf}\QuickModel
DefaultGroupName=QuickModel
DisableProgramGroupPage=yes
; 装到用户目录、免管理员权限
PrivilegesRequired=lowest
OutputDir=.
OutputBaseFilename=QuickModel-Setup
SetupIconFile=icon.ico
Compression=lzma
SolidCompression=yes
WizardStyle=modern
; 安装/更新时自动关闭正在运行的旧 QuickModel，避免文件占用
CloseApplications=yes
RestartApplications=no
; 仅让 Inno 的重启管理器关注本应用，避免误关闭其他 WebView2 应用。
CloseApplicationsFilter=QuickModel.exe

[Languages]
Name: "chinesesimplified"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "创建桌面快捷方式"; GroupDescription: "附加任务:"; Flags: checkedonce

[Files]
Source: "dist\QuickModel\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion

[Icons]
Name: "{group}\QuickModel"; Filename: "{app}\QuickModel.exe"
Name: "{group}\卸载 QuickModel"; Filename: "{uninstallexe}"
Name: "{autodesktop}\QuickModel"; Filename: "{app}\QuickModel.exe"; Tasks: desktopicon

[Run]
; 交互安装：完成页勾选「运行」
Filename: "{app}\QuickModel.exe"; Description: "运行 QuickModel"; Flags: nowait postinstall skipifsilent runasoriginaluser
; 静默安装（自动更新走 /SILENT）：安装末尾无条件拉起新版，实现更新后自动重启
Filename: "{app}\QuickModel.exe"; Flags: nowait runasoriginaluser; Check: WizardSilent
