//go:build !android

package runtime

import (
	"net"
	"testing"
)

func TestDiffInterfaces(t *testing.T) {
	tests := []struct {
		name string
		old  []net.Interface
		new  []net.Interface
		want string
	}{
		{
			name: "empty",
			old:  nil,
			new:  nil,
			want: "",
		},
		{
			name: "new interface",
			old:  []net.Interface{},
			new: []net.Interface{
				{Name: "eth0"},
			},
			want: "eth0 added",
		},
		{
			name: "new interface inserted",
			old: []net.Interface{
				{Name: "lo"},
			},
			new: []net.Interface{
				{Name: "lo"},
				{Name: "eth0"},
			},
			want: "eth0 added",
		},
		{
			name: "interface removed",
			old: []net.Interface{
				{Name: "eth0"},
			},
			new:  []net.Interface{},
			want: "eth0 removed",
		},
		{
			name: "interface removed head",
			old: []net.Interface{
				{Name: "eth0"},
				{Name: "lo"},
			},
			new: []net.Interface{
				{Name: "lo"},
			},
			want: "eth0 removed",
		},
		{
			name: "interface up",
			old: []net.Interface{
				{Name: "eth0"},
			},
			new: []net.Interface{
				{Name: "eth0", Flags: net.FlagUp},
			},
			want: "eth0 up",
		},
		{
			name: "interface down",
			old: []net.Interface{
				{Name: "eth0", Flags: net.FlagUp},
			},
			new: []net.Interface{
				{Name: "eth0"},
			},
			want: "eth0 down",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := diffInterfaces(tt.old, tt.new); got != tt.want {
				t.Errorf("diffInterfaces() = %q, want %q", got, tt.want)
			}
		})
	}
}

type strAddr string

func (addr strAddr) String() string { return string(addr) }
func (strAddr) Network() string     { return "" }

func TestDiffAddrs(t *testing.T) {
	tests := []struct {
		name     string
		oldAddrs []net.Addr
		newAddrs []net.Addr
		want     string
	}{
		{
			name:     "addr added",
			oldAddrs: []net.Addr{strAddr("a")},
			newAddrs: []net.Addr{strAddr("a"), strAddr("b")},
			want:     "b added",
		},
		{
			name:     "addr removed",
			oldAddrs: []net.Addr{strAddr("a"), strAddr("b")},
			newAddrs: []net.Addr{strAddr("a")},
			want:     "b removed",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := diffAddrs(tt.oldAddrs, tt.newAddrs); got != tt.want {
				t.Errorf("diffAddrs() = %q, want %q", got, tt.want)
			}
		})
	}
}
