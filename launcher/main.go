package main
import("os";"os/exec";"path/filepath";"syscall";"unsafe")
func msg(s string){u,_:=syscall.UTF16PtrFromString(s); t,_:=syscall.UTF16PtrFromString("SportClub"); syscall.NewLazyDLL("user32.dll").NewProc("MessageBoxW").Call(0,uintptr(unsafe.Pointer(u)),uintptr(unsafe.Pointer(t)),0x10)}
func main(){e,err:=os.Executable();if err!=nil{return}; root:=filepath.Dir(e); electron:=filepath.Join(root,"desktop","node_modules","electron","dist","electron.exe"); if _,err=os.Stat(electron);err!=nil{msg("Run setup-desktop.bat first.");return}; c:=exec.Command(electron,filepath.Join(root,"desktop"));c.Dir=root;c.SysProcAttr=&syscall.SysProcAttr{HideWindow:true};if err=c.Run();err!=nil{msg(err.Error())}}
