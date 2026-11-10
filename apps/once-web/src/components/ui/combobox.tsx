import { useState } from "react";
import { Check, ChevronsUpDown, Search } from "lucide-react";
import { Button } from "./button";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "./command";
import { cn } from "@/lib/utils";

export interface ComboboxOption { value: string; label: string; description?: string; disabled?: boolean }
export function Combobox({ value, options, onValueChange, placeholder = "请选择", label, disabled = false }: {
  value: string; options: ComboboxOption[]; onValueChange: (value: string) => void;
  placeholder?: string; label: string; disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find(option => option.value === value);
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger asChild>
      <Button variant="outline" role="combobox" aria-expanded={open} aria-label={label} disabled={disabled} className="once-combobox">
        <span>{selected?.label || placeholder}</span><ChevronsUpDown aria-hidden="true" size={16} />
      </Button>
    </PopoverTrigger>
    <PopoverContent align="start" className="once-combobox-options" style={{ width: "var(--radix-popover-trigger-width)" }}>
      <Command><CommandInput placeholder={`搜索${label}`} aria-label={`搜索${label}`} />
        <CommandList><CommandEmpty><Search size={18} />没有匹配选项</CommandEmpty><CommandGroup>
          {options.map(option => <CommandItem key={option.value} value={`${option.label} ${option.description || ""} ${option.value}`} disabled={option.disabled}
            onSelect={() => { onValueChange(option.value); setOpen(false); }}>
            <Check size={16} aria-hidden="true" className={cn("shrink-0", value === option.value ? "opacity-100" : "opacity-0")} />
            <span><strong>{option.label}</strong>{option.description && <small>{option.description}</small>}</span>
          </CommandItem>)}
        </CommandGroup></CommandList>
      </Command>
    </PopoverContent>
  </Popover>;
}
