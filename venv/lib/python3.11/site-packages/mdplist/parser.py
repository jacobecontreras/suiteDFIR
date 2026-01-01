import io
import struct
import datetime


def load(filename):
    """
    Parse a DEBA/MDPLIST file from a given filename.

    Args:
        filename (str): The path to the file to be parsed.

    Returns:
        Union[dict, list]: Parsed data as a dictionary or list, depending on the file contents.
    """
    with open(filename, 'rb') as f:
        data = f.read()
    return loads(data)


def loads(data):
    """
    Parse a DEBA/MDPLIST file from bytes.

    Args:
        data (bytes): The binary data of the file.

    Returns:
        Union[dict, list]: Parsed data as a dictionary or list, depending on the file contents.
    """
    if not data.startswith(b'\xDE\xBA\x00\x01'):
        raise ValueError("Invalid MDPLIST file format")

    return Parser(data).parse()


class Parser:
    def __init__(self, data):
        self.data_stream = io.BytesIO(data)
        self.keys = self.read_keys()

    def parse(self):
        """
        Parse the entire MDPLIST file and return the root structure.

        Returns:
            Union[dict, list]: The root structure of the parsed data.
        """
        self.data_stream.seek(0)
        # Validate magic number
        if not self.data_stream.read(4).startswith(b'\xDE\xBA\x00\x01'):
            raise ValueError("Invalid MDPLIST file format")

        self.data_stream.seek(14)
        root_offset, root_type, root_end_offset = struct.unpack('<IBI', self.data_stream.read(9))

        return self.process_entry(root_offset, root_type)

    def read_keys(self):
        self.data_stream.seek(6)
        (end_keys, start_keys) = struct.unpack('<II', self.data_stream.read(8))
        # print(end_keys, start_keys)
        keys = {}
        if start_keys > 0:
            self.data_stream.seek(start_keys)
            while self.data_stream.tell() < end_keys:
                key_offset = self.data_stream.tell() - start_keys
                (length,) = struct.unpack('H', self.data_stream.read(2))
                key = self.data_stream.read(length).decode('utf-8')
                keys[key_offset] = key
                self.data_stream.read(1)
        return keys

    def get_nested_list(self, offset):
        # print('parsing list at offset:', offset)
        root = []
        self.data_stream.seek(offset)
        (length, num_records, data_length) = struct.unpack('<IHI', self.data_stream.read(10))
        data_bytes_to_read = data_length - 10  # Subtract Header - header is part of data_length
        inner_data = self.data_stream.read(data_bytes_to_read)
        footer = self.data_stream.read(length - data_length + 4)  # Add 4 for the length lost above
        if num_records > 0 and len(footer) / num_records != 5:
            print('warning footer not proper length')
        footer_entries = []
        for i in range(0, num_records):
            footer_entry = struct.unpack('<IB', footer[5 * i:5 * i + 5])
            footer_entries.append(footer_entry)
        # print(footer_entries)
        for footer_entry in footer_entries:
            root.append(self.process_entry(footer_entry[0], footer_entry[1]))

        return root

    def get_nested_dictionary(self, offset):
        # print('parsing dict at offset:', offset)
        root = {}
        self.data_stream.seek(offset)
        # print(self.data_stream.read(10).hex())
        self.data_stream.seek(offset)
        (length, num_records, data_length, unk_footer_entries) = struct.unpack('<IHIH', self.data_stream.read(12))
        unk_footer_entries += 1
        data_bytes_to_read = data_length - 12  # Subtract Header - header is part of data_length
        inner_data = self.data_stream.read(data_bytes_to_read)
        footer = self.data_stream.read(length - data_length + 4)  # Add 4 for the length lost above


        top_footer_entries = []
        for i in range(0, unk_footer_entries):
            footer_entry = struct.unpack('<H', footer[2 * i:2 * i + 2])[0]
            top_footer_entries.append(footer_entry)

        #print(num_records)
        #print(unk_footer_entries)
        #print(top_footer_entries)

        footer_offset = unk_footer_entries * 2
        # print('Footer Offset is:', footer_offset)

        # print('footer len:', len(footer))
        if num_records > 0 and (len(footer) - footer_offset) / num_records != 9:
            print('warning footer not proper length')

        footer_entries = []
        for i in range(0, num_records):
            footer_entry = struct.unpack('<IIB', footer[footer_offset + (9 * i):footer_offset + (9 * i + 9)])
            footer_entries.append(footer_entry)
        # print(footer_entries)
        for footer_entry in footer_entries:
            root[self.keys[footer_entry[0]]] = self.process_entry(footer_entry[1], footer_entry[2])
        return root

    def get_long(self, offset):
        self.data_stream.seek(offset)
        return struct.unpack('<q', self.data_stream.read(8))[0]

    def get_float(self, data):
        packed = struct.pack('<I', data)
        return struct.unpack('<f', packed)[0]

    def get_double(self, offset):
        self.data_stream.seek(offset)
        return struct.unpack('<d', self.data_stream.read(8))[0]

    def get_string(self, offset):
        self.data_stream.seek(offset)
        string_length = struct.unpack('<I', self.data_stream.read(4))[0]
        return self.data_stream.read(string_length - 1).decode('utf-8')

    def get_unicode_string(self, offset):
        self.data_stream.seek(offset)
        string_length = struct.unpack('<I', self.data_stream.read(4))[0]
        string_data = self.data_stream.read(string_length)
        if string_data.startswith(b'\xff\xfe'):
            encoding = 'utf-16-le'  # UTF-16 Little-Endian
            strip = 2
        elif string_data.startswith(b'\xfe\xff'):
            encoding = 'utf-16-be'  # UTF-16 Big-Endian
            strip = 2
        elif string_data.startswith(b'\xef\xbb\xbf'):
            encoding = 'utf-8-sig'  # UTF-8 with BOM
            strip = 3
        else:
            encoding = 'utf-8'
            strip = 0
        return string_data[strip:].decode(encoding)

    def get_cfstring(self, offset):
        self.data_stream.seek(offset + 8)
        # cfstring_length = struct.unpack('<I', self.data_stream.read(4))[0]
        # Can we just skip 8 bytes and read the other length?
        # cfstring = self.data_stream.read(cfstring_length)
        string_length = struct.unpack('<I', self.data_stream.read(4))[0]
        return self.data_stream.read(string_length).decode('utf-8')

    def get_int(self, data):
        return struct.unpack('<i', data)

    def get_null(self):
        return None

    def get_binary(self, offset):
        self.data_stream.seek(offset)
        binary_length = struct.unpack('<I', self.data_stream.read(4))[0]
        return self.data_stream.read(binary_length)

    def get_unknown(self, data, type):
        print('WARNING! this data is unknown')

        #unknowns[type].append(hex(data))

        return hex(data) + ' - Unknown Type: ' + type

    def get_boolean(self, data):
        return True if data else False

    def get_date(self, offset):
        seconds = self.get_double(offset)

        epoch = datetime.datetime(2001, 1, 1)
        return epoch + datetime.timedelta(seconds=seconds)

    def process_entry(self, offset, entry_type):
        if entry_type == 0xF0:
            return self.get_nested_list(offset)
        elif entry_type == 0xF1:
            return self.get_nested_dictionary(offset)
        elif entry_type == 0xF4:
            return self.get_string(offset)
        elif entry_type == 0xF5:
            return self.get_unicode_string(offset)
        elif entry_type == 0xF6:
            return self.get_binary(offset)
        elif entry_type == 0xF7:
            return self.get_cfstring(offset)
        elif entry_type == 0xE0:
            return self.get_null()
        elif entry_type == 0xE1:
            return self.get_boolean(offset)
        elif entry_type == 0xE2:
            return offset
        elif entry_type == 0xE3:
            return self.get_float(offset)
        elif entry_type == 0x13:
            return self.get_date(offset)
        elif entry_type == 0x23:
            return self.get_long(offset)
        elif entry_type == 0x33:
            return self.get_double(offset)
        else:
            print('unknown type', hex(entry_type), 'at offset', offset)
            return self.get_unknown(offset, hex(entry_type))

