#Change History
#Version				Modified By		Modification Date		Implemenation Date
#downloadTxnFilesv7d	Anbu			02-Nov-2024
#1. Changes in New Setup, related to create Archive folder under claims, resubmission & remittance
#2. To seperate out .xml, .bat & downloadlog-2024-11-02.xls for client wise (to avoid overwrite by 2nd/last setup)
#	Added facility part of Global
#	Added back hour/minu/secs part of .csv and .log files
#3. To validate and correct logging corrections:
#downloadTxnFilesv7d	Anbu			26-Nov-2024				26-Nov-2024
#4. Fixed the code at line number 427, to avoid writing Remittance file in claim folder.
#4a. Command to create updated .exe
#	D:\KaaryaaDigital\Clients\ShafaAPI>pyinstaller downloadTxnFilesv7d.py
#	Files will get created under \dist\downloadTxnFilesv7d\downloadTxnFilesv7d.exe
#		can be renamed as 
#5. downloadTxnFilesv8a	Anbu			23-May-2025				
#	To enhance the Resubmission part to remove the Attachments
#	Added functions: 	remove_attachments_from_resubmissionfiles,
#   					remove_attachments_from_file
#6. downloadTxnFilesv8b	Anbu			24-Feb-2026
#	Fix for Shafafiya API 1000-file cap: split search date range into
#	2-hour intervals and call API repeatedly for each window.
#	Added function:		build_and_execute_search_request(from_str, to_str, interval_idx)
#	Changed:			mainsub() 'h' handler - interval loop replaces single API call
#	Changed:			mainsub() 'hff' handler - glob all interval response files
#7. downloadTxnFilesv8c	Anbu			07-Mar-2026
#	Fix for Shafafiya API error response not being detected before filename parsing.
#	Problem: When Shafafiya returns a non-zero DownloadTransactionFileResult (e.g. -6
#	         "File not found"), the <fileName/> tag is self-closing (empty). The existing
#	         code attempted to parse the filename regardless, causing find() to return -1
#	         for </fileName>. This made the FileName slice span the entire SOAP envelope
#	         body, printing garbled XML as the "FileName 1st:" output. The subsequent
#	         while len(FileNameXtn) > 4 loop then ran slowly on that huge string.
#	         During long historical runs this caused the session to appear frozen/hung.
#	Fix:    In DownloadHistoryTxnFile(): added API result code check immediately after
#	         the response XML is read into xmlBody1. If DownloadTransactionFileResult != '0',
#	         log the result code and errorMessage, then return '' cleanly — skipping all
#	         filename/content parsing entirely.
#	Changed:	DownloadHistoryTxnFile() — added v8c API result check block before parse
#	Changed:	GetHistoryTxnFileDownload() — added skip counter; skip os.path.exists
#	            check when DownloadHistoryTxnFile returns '' (known API error skip)
#	            Added end-of-function run summary: X downloaded, Y skipped (API error),
#	            Z not found on disk
#	Note:   The exact reason Shafafiya returns -6 (file retention period, file never
#	         generated, or other server-side cause) is not confirmed from documentation.
#	         The fix handles all non-zero result codes defensively.
#8. downloadTxnFilesv8d	Anbu			08-Mar-2026
#	Fix for unhandled OSError [Errno 28] No space left on device crashing the process.
#	Problem: During a long historical run the destination drive ran out of disk space.
#	         Two failures resulted:
#	         (a) remove_attachments_from_file() caught IOError on the write but only
#	             printed "An error occurred" — the OSError then propagated uncaught up
#	             through GetHistoryTxnFileDownload → mainsub → main, crashing with a
#	             raw traceback and "[PYI-13092:ERROR] Failed to execute script".
#	         (b) No disk-space check existed anywhere before writing files, so the
#	             first indication of a full disk was a hard crash mid-run.
#	Fix:    (a) Added check_disk_space_mb() utility — uses shutil.disk_usage() to
#	             return free MB for a given path.
#	        (b) In DownloadHistoryTxnFile(): before writing the final decoded file
#	             (both .xml and .zip paths) check free space >= MIN_FREE_DISK_MB (50 MB).
#	             If low: log CRITICAL, print warning, return '' cleanly (same as API skip).
#	        (c) In DownloadHistoryTxnFile(): wrap the open(..., 'w') and open(..., 'wb')
#	             write blocks with OSError catch — if errno 28 (ENOSPC), log CRITICAL
#	             and return '' rather than crashing.
#	        (d) In remove_attachments_from_file(): wrap the write block with OSError
#	             catch for errno 28 — log CRITICAL and raise so caller is aware, but
#	             do NOT silently swallow it.
#	        (e) In GetHistoryTxnFileDownload(): catch OSError errno 28 around the
#	             DownloadHistoryTxnFile call — log CRITICAL, print disk-full warning,
#	             break the FileID loop, and return summary so the run ends cleanly.
#	        (f) In main(): wrap the outer facility loop with OSError errno 28 catch —
#	             logs CRITICAL and exits cleanly with a clear message rather than a
#	             raw crash traceback.
#	Changed:	Added import errno at top
#	Changed:	Added check_disk_space_mb() utility function
#	Changed:	DownloadHistoryTxnFile() — pre-write disk check + OSError wrap on writes
#	Changed:	remove_attachments_from_file() — OSError wrap on write, errno 28 logged
#	Changed:	GetHistoryTxnFileDownload() — OSError errno 28 catch breaks FileID loop
#	Changed:	main() — OSError errno 28 catch on outer facility processing loop
#	Added constant: MIN_FREE_DISK_MB = 50  (configurable at top of main())
#9. downloadTxnFilesv8e	Anbu			08-Mar-2026
#	Fix for severely slow performance on historical/long-period downloads (12-18 hrs).
#	Root cause analysis:
#	  remove_attachments_from_resubmissionfiles() was called INSIDE the per-file
#	  download loop (after every single claim XML file). This function calls
#	  os.listdir() then reads and regex-scans every file in the resubmission folder
#	  twice (Attachment + Observation patterns) on each call. With N claim files
#	  and M resubmission files accumulated, total file reads = N x M x 2 — pure
#	  O(n²) behaviour. For a 1-month history run (~1000 claims, ~200 resubmissions)
#	  this produced ~400,000 redundant file reads. Estimated contribution: 6-12 hrs.
#	Fix:
#	  Removed remove_attachments_from_resubmissionfiles() from inside
#	  DownloadHistoryTxnFile(). It now runs ONCE per GetHistoryTxnFileDownload()
#	  call after ALL FileIDs in the batch are processed — guarded by
#	  transactionID == '2' (claims only). Net result: O(n) instead of O(n²).
#	  FindnMoveResubmisison() kept inside per-file loop — it operates only on the
#	  single file just downloaded, O(1), no performance issue.
#	Note:
#	  sleep(3) between intervals deliberately retained at 3 seconds. Although
#	  subprocess.Popen + communicate() is fully blocking (no async risk), the
#	  3-second pause is a courtesy rate-limit to the Shafafiya endpoint and was
#	  kept as originally set in v8b to avoid any risk of request flooding.
#	Changed:	DownloadHistoryTxnFile() — removed remove_attachments_from_resubmissionfiles()
#	            call from inside per-file loop
#	Changed:	GetHistoryTxnFileDownload() — added single remove_attachments_from_resubmissionfiles()
#	            call after the FileID while loop, guarded by transactionID == '2'
#10. downloadTxnFilesv8f	Anbu			09-Mar-2026
#	Fix for HisDnld:1.6 false positive — every downloaded file was incorrectly logged
#	as "Not Downloaded Successfully, please recheck" despite being downloaded correctly.
#	Pre-existing cosmetic bug, present since early versions, now fixed before SaaS migration.
#	Root cause (two separate issues):
#	  (a) XML path: DownloadHistoryTxnFile() returned finalfile = str(FileName) which
#	      is the bare Shafafiya filename e.g. "MF2618_H13238-THIQA-CRH0249838-JUNE-2025.xml"
#	      with no folder prefix. GetHistoryTxnFileDownload() then called os.path.exists()
#	      on that bare name — which looked in the current working directory (C:\Users\USER\
#	      Documents\MF2618\), not in the claims/remittance subfolder. Always returned False.
#	  (b) ZIP path: after successful extraction, os.remove(finalfilewithfolder) deletes
#	      the .zip file intentionally. DownloadHistoryTxnFile() then returned the bare
#	      original FileName. os.path.exists() on a deleted file always returned False.
#	      The file was actually downloaded and extracted correctly — the check was wrong.
#	Fix:
#	  (a) XML path: return finalfilewithfolder (full absolute path) instead of finalfile.
#	      os.path.exists(finalfilewithfolder) in GetHistoryTxnFileDownload now correctly
#	      finds the file in the claims or remittance subfolder.
#	  (b) ZIP path: return sentinel string 'ZIP_EXTRACTED' after successful extraction.
#	      GetHistoryTxnFileDownload checks for this sentinel and counts it as
#	      count_downloaded — no os.path.exists() call needed since zip is removed by design.
#	  (c) GetHistoryTxnFileDownload(): added elif branch for 'ZIP_EXTRACTED' sentinel
#	      between the '' (API skip) and os.path.exists() branches.
#	      HisDnld:1.5 log message updated to distinguish XML vs ZIP success.
#	      HisDnld:1.6 now only fires for genuine failures.
#	Changed:	DownloadHistoryTxnFile() XML path — return finalfilewithfolder instead of finalfile
#	Changed:	DownloadHistoryTxnFile() ZIP path — return 'ZIP_EXTRACTED' sentinel after os.remove()
#	Changed:	GetHistoryTxnFileDownload() — added elif 'ZIP_EXTRACTED' branch (count_downloaded)
#	            updated HisDnld:1.5 log message, HisDnld:1.6 now genuine-failure-only
#11. downloadTxnFilesv8h	Anbu			11-Mar-2026
#	Phase 0 Foundation Hardening — httpx replaces curl subprocess, ConfigProvider abstraction.
#	Changes:
#	(a) Added imports: httpx_soap (soap_search_transactions, soap_download_transaction)
#	                   config_provider (ConfigProvider, LocalINIProvider)
#	(b) build_and_execute_search_request(): curl subprocess block replaced with
#	    soap_search_transactions(req_fname, resp_fname, interval_idx, logwriter, dlfh)
#	    — eliminates shell=True, subprocess.Popen, process.communicate()
#	    — httpx is synchronous/blocking, no race conditions, no timeout guesswork
#	(c) DownloadHistoryTxnFile(): curl subprocess block replaced with
#	    soap_download_transaction(requestfile, responsefile, logwriter, dlfh)
#	    — same blocking semantics, cleaner error propagation
#	(d) main(): configparser.ConfigParser() / config.read() replaced with
#	    LocalINIProvider('shafafiaapi.ini') / provider.get_main_config()
#	    — ConfigProvider ABC enables DB-backed config in Phase 2 with zero main() changes
#	(e) Removed 4 × sleep(10) between mainsub() calls in facility loop
#	    — redundant: httpx blocking makes the inter-call sleeps unnecessary
#	    — sleep(3) between interval API calls retained (courtesy rate-limit, not correctness guard)
#	Changed:	imports — added httpx_soap, config_provider
#	Changed:	build_and_execute_search_request() — curl → soap_search_transactions()
#	Changed:	DownloadHistoryTxnFile() — curl → soap_download_transaction()
#	Changed:	main() — configparser → LocalINIProvider
#	Changed:	main() facility loop — removed 4 × sleep(10)
#	            updated HisDnld:1.5 log message, HisDnld:1.6 now genuine-failure-only
#12. ClaimSync2 v2.4	Anbu			12-Mar-2026
#	Phase 2 engine — cloud-only BAU download flow.
#	Removed all desktop/on-prem logic: interactive menu, newclient/renlic/vallic,
#	shafafiaapi.ini dependency, LocalINIProvider, license expiry, host-lock (enchost).
#	Config now sourced exclusively from Azure PostgreSQL (DBConfigProvider) +
#	Azure Key Vault (KeyVaultCredentialProvider) via CLAIMSSYNC_TENANT and
#	CLAIMSSYNC_KV_URI env vars — no .ini file needed or referenced.
#	Only supported invocation: python ClaimSync2.py h (BAU history download)
#	Changed:	imports — removed config_provider (LocalINIProvider no longer used)
#	Changed:	main() — full rewrite: DB+KV config only, h-parameter only,
#	            clean facility loop, explicit FATAL messages for missing env vars
#	            or config load failures, OSError disk-full handler retained

import cryptocode, pyotp, qrcode, base64, shutil, arrow, zipfile
import sys, configparser, subprocess, os, time, platform, re, errno
from datetime import date, datetime, timedelta
import glob
from pathlib import Path
# v8h Phase 0: httpx SOAP helpers replace curl subprocess
from httpx_soap import soap_search_transactions, soap_download_transaction
# v2.4: config_provider / LocalINIProvider removed — ClaimSync2 is cloud-only.
# Config loaded via DBConfigProvider + KeyVaultCredentialProvider (imported in main()).

def display_menu():
	print("\nMenu:")
	print("1 Admin : New Client Onboarding")
	print("2 Admin : Validate Licence")
	print("3 Admin : Renew Licence")
	#print("4 Admin : DeActivate FileDownload")
	#print("5 Admin : Activate FileDownload")
	print("9 Exit")

def handle_option(choice):
	if choice == 1:
		downloadtype = 'newclient'
	elif choice == 2:
		downloadtype = 'vallic'
	elif choice == 3:
		downloadtype = 'renlic'
	elif choice == 4:
		downloadtype = 'activate'
	elif choice == 5:
		downloadtype = 'deactivate'	
	elif choice == 9:
		print("Exiting...")
	else:
		print("Invalid choice. Please try again.")
		return ''
	return downloadtype

def remove_attachments_from_resubmissionfiles(folder_path):
    """
    Reads and prints the content of each file in the given folder.

    Args:
        folder_path (str): The path to the folder containing the files.
    """
    try:
        for filename in os.listdir(folder_path):
            filepath = os.path.join(folder_path, filename)

            # Check if it's a file (not a directory)
            if os.path.isfile(filepath):
                #print(f"Reading file: {filename}")
                logline = logwriter('i', 'Resub-Attach:1.1 File: '+filepath+'to check <Attachment>')
                dlfh.write(f"{logline}")
    
                start_pattern = "<Attachment>"
                end_pattern = "</Attachment>"
                remove_attachments_from_file(filepath, start_pattern, end_pattern)
                start_pattern = "<Observation>"
                end_pattern = "</Observation>"
                remove_attachments_from_file(filepath, start_pattern, end_pattern)

    except FileNotFoundError:
        print(f"Error: Folder not found at path: {folder_path}")
        logline = logwriter('i', 'Resub-Attach:1.1 Error: Folder not found at path:'+folder_path)
        dlfh.write(f"{logline}")

    except Exception as e:
       print(f"An error occurred: {e}")
       
    return

#	To enhance the Resubmission part to remove the Attachments
def remove_attachments_from_file(filepath, start_pattern, end_pattern):
    """
    Reads a file, removes the portion between the start and end patterns (inclusive),
    and writes the modified content back to the file.

    Args:
        filepath (str): The path to the file.
        start_pattern (str): The starting pattern to search for (regex).
        end_pattern (str): The ending pattern to search for (regex).
    """
	#file_path = "Resubmission_MF1327_A001_2023-12-19_IS038658.xml"
    #start_pattern = "<Attachment>"
    #end_pattern = "</Attachment>"

    try:
        with open(filepath, 'r') as file:
            content = file.read()
    except FileNotFoundError:
         raise FileNotFoundError(f"File not found: {filepath}")

#	logline = logwriter('i', 'Resub-Attach:1.2 Going to check <Attachment> in file:'+filepath)
#    dlfh.write(f"{logline}")

    # Construct the regex pattern to match the portion to be removed
    pattern = re.compile(re.escape(start_pattern) + r".*?" + re.escape(end_pattern), re.DOTALL)
    
    # Substitute the matched portion with an empty string
    modified_content = re.sub(pattern, '', content)

    try:
        with open(filepath, 'w') as file:
            file.write(modified_content)
            logline = logwriter('i', 'Resub-Attach:1.3 Removed <Attachment> in the file: '+filepath)
            dlfh.write(f"{logline}")

    except OSError as ose:
        # v8d: Catch OSError explicitly — errno 28 means disk full.
        # Re-raise so GetHistoryTxnFileDownload can catch it and break cleanly.
        if ose.errno == errno.ENOSPC:
            logline = logwriter('c', f'Resub-Attach:DISK-FULL OSError errno 28 writing {filepath} — disk is full')
            dlfh.write(f"{logline}")
        raise   # always re-raise OSError — do not swallow disk-full silently
    except IOError:
        raise IOError(f"Error writing to file: {filepath}")

    return

def check_folder_exists_and_writable(path):
    """Checks if a folder exists and has write permission."""

    if not os.path.exists(path):
        return False, "Folder does not exist."
    if not os.path.isdir(path):
        return False, "Path is not a directory."
    if not os.access(path, os.W_OK):
        return False, "Folder does not have write permission."

    return True, ""

def check_disk_space_mb(path):
	# v8d: Returns free disk space in MB for the drive/volume containing 'path'.
	# Uses shutil.disk_usage() which works on both Windows and Linux.
	# Returns 0 if the path does not exist or the check fails, so callers
	# that compare >= MIN_FREE_DISK_MB will treat an error as low-space.
	try:
		usage = shutil.disk_usage(path)
		return usage.free / (1024 * 1024)   # bytes → MB
	except Exception:
		return 0

def get_end_of_year_date():
  """Gets the end date of the current year."""
  today = date.today()
  end_of_year = date(today.year, 12, 31)
  return end_of_year

def getkey():
    """Generates a key for encryption and decryption."""
    return 'vgVVtBV8YCJeltn6DwzhnmVRqKjy3CBEdLvw1o_yclM='

def encrypt_message(message, key):
	#Encrypts a message using the given key.
	encrypted_message = cryptocode.encrypt(message,key)
	return encrypted_message

def decrypt_message(encrypted_message, key):
    """Decrypts an encrypted message using the given key."""
    decrypted_message = cryptocode.decrypt(encrypted_message,key)
    return decrypted_message

def get_user_input(prompt, default_value):
    """Gets user input with a default value if the user enters nothing."""

    value = input(f"{prompt} (default: {default_value}): ")
    return value if value else default_value

def askitsolsauthenticateQRCode():
	secret_key = pyotp.random_base32()
	#print("Secret Key||", secret_key+"||")
	totp = pyotp.TOTP(secret_key)

	# Generating the provisioning URI
	provisioning_uri = totp.provisioning_uri("lsanbu@gmail.com", issuer_name="ASKITSolsAPI")

	# Generating a QR code
	img = qrcode.make(provisioning_uri)
	img.save("ASKITSolsAPIAdmin.png")
	return

def encryptdecrypt(encrdecr, toencryptdecrypt):
	message = toencryptdecrypt
	key = getkey()
	if encrdecr == 'e':
		# Generate a new key

		# Encrypt the message
		encrypted_message = encrypt_message(message, key)
		#print("Encrypted message:", encrypted_message)
		return encrypted_message
	elif encrdecr == 'd':
		# Decrypt the message
		decrypted_message = decrypt_message(message, key)
		#print("Decrypted message:", decrypted_message)
		return decrypted_message

def askitsolsauthenticate():
	# Generate a secret key for the user
	secret_key = "IIBPORVRB5I6XVIB5C6C4RNQ5M3BQ7CJ" #pyotp.random_base32()

	# Generate the OTP URI for the user to scan with their authenticator app
	totp = pyotp.TOTP(secret_key)
	#uri = totp.provisioning_uri("user@example.com", issuer_name="MyApp")
	#print(uri)

	# Verify the OTP entered by the user
	user_entered_otp = input("Enter OTP: ")
	if totp.verify(user_entered_otp):
		#print("Admin Authentication successful")
		admin='y'
	else:
		#print("Admin Authentication failed")
		admin = 'n'
	return admin

def createini():
	inifilename = 'shafafiaapi.ini'
	if os.path.exists(inifilename):
		print('Warning!!!', "Admin 1.1 File: "+inifilename +" Already Exists - Client Onboarding Completed!?")
		logline = logwriter('w', "Admin 1.1 File: "+inifilename +" Already Exists - Client Onboarding Completed!?")
		dlfh.write(f"{logline}")
		return
	else:
		logline = logwriter('i', "Admin 1.1a INI file: "+inifilename +" about to create, please input valid values!")
		dlfh.write(f"{logline}")

	defaultappfolder = ''
	appfolder_path = os.getcwd().replace('\\', '/') #get_user_input("Input Application main folder e.g. D:/xampp/htdocs/itgym/ShafaAPI/", defaultappfolder)
	#print(appfolder_path)
	exists, message = check_folder_exists_and_writable(appfolder_path)
	if exists:
		#print("Folder exists and is writable.")
		logline = logwriter('i', 'Folder exists and is writable.')
		dlfh.write(f"{logline}")
		tempfolder = appfolder_path+'/Temp/'
		#print(tempfolder)
		if not os.path.exists(tempfolder):
			#print('creating new folder:', tempfolder)
			logline = logwriter('i', 'creating new folder: '+tempfolder)
			dlfh.write(f"{logline}")
			os.makedirs(tempfolder)
	else:
		print(f"Error: {message}")
		if not os.path.exists(appfolder_path):
			#print('creating new folder:', appfolder_path)
			logline = logwriter('i', 'creating new folder: '+appfolder_path)
			dlfh.write(f"{logline}")
			os.makedirs(appfolder_path)
			tempfolder = appfolder_path+'/Temp/'
			os.makedirs(tempfolder)

	inifilenamewithfolder = appfolder_path + '/'+ inifilename
	print(inifilenamewithfolder)
	with open(inifilenamewithfolder, "w") as inif:
		#write ShafaAPI Main Configs
		mainline = '[shafaapi-main]'+'\n'
		inif.write(mainline)
		mainline = 'active=y'+'\n'
		inif.write(mainline)
		default_lic_enddate = get_end_of_year_date()
		#print(default_lic_enddate)
		inputvalue = get_user_input("Please input License End Date : ", default_lic_enddate)
		enclicenddate = encryptdecrypt('e', str(inputvalue))
		mainline = 'validuntil='+enclicenddate+'\n'
		inif.write(mainline)
		# Message to be encrypted
		hostname = platform.node()
		enchost = encryptdecrypt('e', hostname)
		#print('enchost', enchost)
		mainline = 'enchost='+enchost+'\n'
		inif.write(mainline)
		inputvalue = get_user_input("How many number of setup for this facility?", 1)
		facilitycnt = int(inputvalue)
		mainline = 'noofsetup='+str(inputvalue)+'\n'
		inif.write(mainline)
		mainline = 'systemfolder='+appfolder_path+'/\n'
		inif.write(mainline)
		mainline = 'tempfolder='+appfolder_path+'/Temp/'+'\n'
		inif.write(mainline)

		for facindex in range(facilitycnt):
			facindex = facindex + 1
			print('please input the facilty: ', facindex)
			mainline = '\n[client-config-'+str(facindex)+']\n'
			inif.write(mainline)
			inputvalue = get_user_input("Input Facility ID for the Faciltiy: "+str(facindex), "")
			facilityid = inputvalue
			mainline = 'facility='+inputvalue+'\n'
			inif.write(mainline)
			inputvalue = get_user_input("Input userid for the Faciltiy: "+str(facindex), "")
			mainline = 'userid='+inputvalue+'\n'
			inif.write(mainline)
			inputvalue = get_user_input("Input password for the Faciltiy: "+str(facindex), "")
			mainline = 'password='+inputvalue+'\n'
			inif.write(mainline)
			if os.path.exists(appfolder_path):
				newfolder = appfolder_path+'/'+facilityid+'/claims/'
				mainline = 'claims='+newfolder+'\n'
				inif.write(mainline)
				os.makedirs(newfolder)
				newfolder = appfolder_path+'/'+facilityid+'/claims/archive/'
				mainline = 'claimsarch='+newfolder+'\n'
				inif.write(mainline)
				os.makedirs(newfolder)

				newfolder = appfolder_path+'/'+facilityid+'/resubmission/'
				mainline = 'resubmission='+newfolder+'\n'
				inif.write(mainline)
				os.makedirs(newfolder)
				newfolder = appfolder_path+'/'+facilityid+'/resubmission/archive/'
				mainline = 'resubmissionarch='+newfolder+'\n'
				inif.write(mainline)
				os.makedirs(newfolder)

				newfolder = appfolder_path+'/'+facilityid+'/remittance/'
				mainline = 'remittance='+newfolder+'\n'
				inif.write(mainline)
				os.makedirs(newfolder)
				newfolder = appfolder_path+'/'+facilityid+'/remittance/archive'
				mainline = 'remittancearch='+newfolder+'\n'
				inif.write(mainline)
				os.makedirs(newfolder)

				mainline = 'direction=1\n'
				inif.write(mainline)
				mainline = 'callerLicense='+facilityid+'\n'
				inif.write(mainline)
				mainline = 'ePartner= \n'
				inif.write(mainline)
				mainline = 'transactionID=2\n'
				inif.write(mainline)
				mainline = 'transactionStatus=2\n'
				inif.write(mainline)
				mainline = 'transactionFileName=\n'
				inif.write(mainline)
				mainline = 'defaultsearch=y\n'
				inif.write(mainline)
				mainline = 'transactionFromDate=01/07/2024 00:00:00\n'
				inif.write(mainline)
				mainline = 'transactionToDate=31/07/2024 00:00:00\n'
				inif.write(mainline)
				mainline = 'minRecordCount=1\n'
				inif.write(mainline)
				mainline = 'maxRecordCount=100000\n'
				inif.write(mainline)

		inif.close
	return

def base64_to_xml(base64_string):
	"""Converts a base64 encoded string to XML."""

	decoded_bytes = base64.b64decode(base64_string)
	xml_string = decoded_bytes.decode('utf-8')
	logline = logwriter('i', 'Decrypt:1.1 base64_to_xml conversion completed successfully and xml_string getting passed...')
	dlfh.write(f"{logline}")

	return xml_string

def logwriter(logtype, logtext):
	if logtype == 'w':
		logtype = "WARNING"
	elif logtype == 'c':
		logtype = "CRITICAL"
	else:
		logtype = "INFO"

	# Get the current date and time
	now = datetime.now()
	# Format the date and time as a string 2024-08-25 13:20:45
	formatted_datetime = now.strftime("%Y-%m-%d-%H-%M-%S")
	logline = f"{logtype} : {formatted_datetime} : {logtext} \n"
	#print("logline ", logline)
	return logline

def FormatDownloadTxnRequestFile(FileID):
	downloadtxnrequestfile = tempfolder+'txnrequest_' +FileID[:8] +'.xml'
	#print("Filename with folder:", downloadtxnrequestfile)
	logline = logwriter('i', 'Dnld:1.1 Processing Start : FormatDownloadTxnRequestFile(FileID) with the file: '+ downloadtxnrequestfile)
	dlfh.write(f"{logline}")

	with open(downloadtxnrequestfile, "w") as hrf:
		#print("To Download New Txn files 7")
		line001 = '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:v2="https://www.shafafiya.org/v2/">'+'\n'
		hrf.write(line001)
		line002 = "   <soapenv:Header/>"+ '\n'
		hrf.write(line002)
		line003 = "   <soapenv:Body>"+ '\n'
		hrf.write(line003)
		line004 = "      <v2:DownloadTransactionFile>"+ '\n'
		hrf.write(line004)
		lineopt = "         <!--Optional:-->"+ '\n'
		hrf.write(lineopt)
		line005 = "        <v2:login>"+userid.strip('"')+"</v2:login>"+ '\n'
		hrf.write(line005)
		hrf.write(lineopt)
		line006 = "        <v2:pwd>"+password.strip('"')+"</v2:pwd>"+ '\n'
		hrf.write(line006)
		hrf.write(lineopt)
		line007 = "        <v2:fileId>"+FileID.strip('"')+"</v2:fileId>"+ '\n'
		hrf.write(line007)
		line008 = "      </v2:DownloadTransactionFile>>"+ '\n'
		hrf.write(line008)
		line009 = "  </soapenv:Body>"+ '\n'
		hrf.write(line009)
		line010 = "</soapenv:Envelope>"
		hrf.write(line010)
		hrf.close
		#curlcommand = 'curl -X POST -H "Content-Type: text/xml; charset=utf-8" -H "SOAPAction: https://www.shafafiya.org/v2/DownloadTransactionFile" -d @'+hrfname+ ' -o ' +hresponsefname+ ' "https://shafafiya.doh.gov.ae/v3/webservices.asmx"'
		#print (curlcommand)
		#dhf = open("downloadhistfileids.bat", "w")
		#dhf.write(curlcommand)
		#dhf.close()
		logline = logwriter('i', 'Dnld:1.2 Processing End : FormatDownloadTxnRequestFile(FileID) with the file: '+ downloadtxnrequestfile)
		dlfh.write(f"{logline}")
	hrf.close()
	return downloadtxnrequestfile

def DownloadHistoryTxnFile(FileID, fileseqno, transactionID ):
	#print('transactionID - beginning of DownloadHistoryTxnFile: ', transactionID)
	responsefile = tempfolder+'txnresponse_' +FileID[:8] +'.xml'
	responsefile_1 = tempfolder+'txnresponse_' +FileID[:8] +'_1.xml'
	requestfile = FormatDownloadTxnRequestFile(FileID)
	logline = logwriter('i', 'Dnld:1.3 Processing Start : DownloadHistoryTxnFile(FileID) with the Request file: '+ requestfile)
	dlfh.write(f"{logline}")
	logline = logwriter('i', 'Dnld:1.4 Processing Start : DownloadHistoryTxnFile(FileID) with the Response file: '+ responsefile_1)
	dlfh.write(f"{logline}")

	with open(requestfile, "r") as fin:
		txnCSVRec = "FileName" + "," + "SenderID" + "," + "ReceiverID" + "," + "TransactionDate" + "," + "RecordCount" + "," + "FileID"
		# v8h Phase 0: Replace curl subprocess with httpx SOAP call.
		# soap_download_transaction() is synchronous/blocking and writes the response
		# to 'responsefile' exactly as curl did — caller reads it immediately after.
		# Returns None on HTTP/connection failure; any non-None means the file is written.
		result = soap_download_transaction(requestfile, responsefile, logwriter, dlfh)
		if result is None:
			logline = logwriter('w', 'Dnld:1.5h soap_download_transaction() failed for requestfile: ' + requestfile)
			dlfh.write(f"{logline}")
			return ''
		with open(responsefile, "r") as infile, open(responsefile_1, "w") as outfile:
			logline = logwriter('i', 'Dnld:1.7 Processing Start responsefile: '+ responsefile)
			dlfh.write(f"{logline}")

			single_line = infile.read().replace("\n", " ") # replace newline with space
			outfile.write(single_line)
			infile.close
			outfile.close
			#print("single_line", single_line)
			xmlBody1 = single_line
			logline = logwriter('i', 'Dnld:1.8 responsefile converted to singline as '+ responsefile_1)
			dlfh.write(f"{logline}")
	fin.close

	# ------------------------------------------------------------------
	# v8c: Check Shafafiya API result code BEFORE attempting any parsing.
	#
	# When Shafafiya cannot fulfil a download request it returns a
	# non-zero DownloadTransactionFileResult code, for example:
	#   -6  "File with id <guid> is not found."
	# In this case <fileName/> is self-closing (empty) and <file/> is
	# also absent.  The previous code had no guard here — find() returned
	# -1 for </fileName>, causing the FileName slice to span the entire
	# SOAP envelope, printing raw XML as the filename.  The subsequent
	# while len(FileNameXtn) > 4 loop then ran slowly on that huge string
	# making the session appear frozen during long historical runs.
	#
	# Fix: extract DownloadTransactionFileResult first.  Any value other
	# than '0' is treated as a server-side error — log it and return ''
	# immediately, skipping all filename/content parsing.
	# ------------------------------------------------------------------
	result_start = xmlBody1.find('<DownloadTransactionFileResult>')
	result_end   = xmlBody1.find('</DownloadTransactionFileResult>')
	if result_start > 0 and result_end > result_start:
		api_result = xmlBody1[result_start + 31 : result_end].strip()
	else:
		# Tag not found at all — treat as unknown error, skip safely
		api_result = 'UNKNOWN'

	if api_result != '0':
		# Non-zero result: extract errorMessage if present, then skip
		err_start = xmlBody1.find('<errorMessage>')
		err_end   = xmlBody1.find('</errorMessage>')
		if err_start > 0 and err_end > err_start:
			error_msg = xmlBody1[err_start + 14 : err_end].strip()
		else:
			error_msg = 'No errorMessage in response'
		print(f'  [SKIP] FileID {FileID} — Shafafiya result [{api_result}]: {error_msg}')
		logline = logwriter('w', f'Dnld:v8c-SKIP FileID {FileID} result [{api_result}]: {error_msg}')
		dlfh.write(f"{logline}")
		return ''   # Caller (GetHistoryTxnFileDownload) checks for '' to count skips
	# ------------------------------------------------------------------
	# v8c end of API result check — only reaches here when result == '0'
	# ------------------------------------------------------------------

	nextFileNameloc1 = 1
	#To get Transaction details
	#get FileName
	nextFileNameloc1 = xmlBody1.find('<fileName>', nextFileNameloc1, )
	#if nextFileNameloc1 <= 0: return
	nextfileloc = xmlBody1.find('</fileName>', nextFileNameloc1, )
	contentloc = xmlBody1.find('<file>', nextFileNameloc1, )
	#if nextFileNameloc1 <= 0: return
	nextcontentloc = xmlBody1.find('</file>', nextFileNameloc1, )
	#print (FileNameloc, SenderIDloc)
	FileName = xmlBody1[nextFileNameloc1+10:nextfileloc]
	print('FileName 1st: ', FileName)
	logline = logwriter('i', 'Dnld:1.8a Actual FileName in the source xml: '+ FileName)
	dlfh.write(f"{logline}")
	dotposition = FileName.rfind('.')
	FileNameXtn = FileName[dotposition+1:]
	#print('FileNameXtn 1st: ', FileNameXtn)
	while len(FileNameXtn) > 4:
		dotposition = FileNameXtn.rfind('.')
		FileNameXtn = FileNameXtn[dotposition+1:]
		#print('FileNameXtn 2nd: ', FileNameXtn)

	FileNameXtn = '.'+FileNameXtn
	FileNameOnly = FileName[:FileName.find('.')]
	FileNameOnly = FileNameOnly + '_' + str(fileseqno)
	FileNameAmended = FileNameOnly + FileNameXtn
	logline = logwriter('i', 'Dnld:1.8b FileNameOnly: '+ FileNameOnly)
	dlfh.write(f"{logline}")
	logline = logwriter('i', 'Dnld:1.8c FileNameXtn: '+ FileNameXtn)
	dlfh.write(f"{logline}")
	logline = logwriter('i', 'Dnld:1.8d FileNameAmended: '+ FileNameAmended)
	dlfh.write(f"{logline}")

	Filecontent = xmlBody1[contentloc+6:nextcontentloc]
	outfile.close
	infile.close
	logline = logwriter('i', 'Dnld:1.9 Able to process responsefile and find Filname: '+ FileName)
	dlfh.write(f"{logline}")
	
	#print('FileNameXtn : ', FileNameXtn)
	#print('transactionID - before check .xml .zip DownloadHistoryTxnFile: ', transactionID)
	if FileNameXtn.lower() == '.xml':
		# Example usage
		logline = logwriter('i', 'Decrypt:1.2 base64_to_xml(Filecontent) function being called to convert the Decrypted content...')
		dlfh.write(f"{logline}")
		xml_data = base64_to_xml(Filecontent)
		#print("Converted file <XML>", xml_data)
		finalfile = str(FileName)
		if transactionID == '2':
			#print('transactionID:2 ', transactionID)
			#7d Commented and used only FileNameOnly to avoid .xml.xml... 
			finalfilewithfolder = claims + FileNameAmended
			#finalfilewithfolder = claims + FileNameOnly
		elif transactionID == '8':
			#print('transactionID:8 ', transactionID)
			#7d Commented and used only FileNameOnly to avoid .xml.xml... 
			#finalfilewithfolder = claims + FileNameAmended
			finalfilewithfolder = remittance + FileNameAmended
			#finalfilewithfolder = claims + FileNameOnly
			
		logline = logwriter('i', 'Dnld:1.8e finalfilewithfolder: '+ finalfilewithfolder)
		dlfh.write(f"{logline}")

		# v8d: Check free disk space before writing — avoids mid-write crash on full disk.
		free_mb = check_disk_space_mb(os.path.dirname(finalfilewithfolder))
		if free_mb < MIN_FREE_DISK_MB:
			logline = logwriter('c', f'Dnld:DISK-FULL Pre-write check failed for {finalfilewithfolder} — only {free_mb:.1f} MB free (minimum {MIN_FREE_DISK_MB} MB required)')
			dlfh.write(f"{logline}")
			print(f'  [DISK FULL] Only {free_mb:.1f} MB free — cannot write {FileNameAmended}. Free up disk space and re-run.')
			return ''   # caller counts this under count_notfound; disk-full break handled in GetHistoryTxnFileDownload

		try:
			with open(finalfilewithfolder, 'w', encoding='utf-8') as f:
				for line in xml_data:
					f.write(f"{line}")
				f.close()
		except OSError as ose:
			# v8d: Catch disk-full (errno 28) and other OS write errors cleanly.
			if ose.errno == errno.ENOSPC:
				logline = logwriter('c', f'Dnld:DISK-FULL OSError errno 28 writing {finalfilewithfolder} — disk is full')
				dlfh.write(f"{logline}")
				print(f'  [DISK FULL] OSError writing {FileNameAmended} — disk is full. Free up space and re-run.')
			else:
				logline = logwriter('c', f'Dnld:OSError [{ose.errno}] writing {finalfilewithfolder}: {ose}')
				dlfh.write(f"{logline}")
			raise   # re-raise so GetHistoryTxnFileDownload can catch and break the loop

		if transactionID == '2':
			#print('To Check Claim is Resubmission!!!')
			#print('finalfilewithfolder', finalfilewithfolder)
			#print('resubmission', resubmission)
			FindnMoveResubmisison(finalfilewithfolder, resubmission)
			# v8e: remove_attachments_from_resubmissionfiles() removed from here.
			# Previously called after every single claim file — O(n²) cost.
			# Now called ONCE after all files in the batch are downloaded.
			# See GetHistoryTxnFileDownload() for the single post-batch call.

		logline = logwriter('i', 'Decrypt:1.2 Decrypted Content written and downloaded as : ' + finalfile )
		dlfh.write(f"{logline}")
		# v8f: Return full path so GetHistoryTxnFileDownload can os.path.exists() correctly.
		# Previously returned bare FileName (no folder) — check always failed.
		return finalfilewithfolder
	elif FileNameXtn.lower() == '.zip':
		# Example usage
		logline = logwriter('i', 'Decrypt:1.2z .Zip to retain and not XML conversion')
		dlfh.write(f"{logline}")
		#print('transactionID:', transactionID)
		finalfile = str(FileName)
		#print('claims: ', claims)
		#print('remittance ', remittance)
		#print('FileNameAmended ', FileNameAmended)
		#print('transactionID:28 ', type(transactionID))
		if transactionID == '2':
			#print('transactionID:2 ', transactionID)
			finalfilewithfolder = claims + FileNameAmended
			extractfolder = claims
		elif transactionID == '8':
			#print('transactionID:8 ', transactionID)
			finalfilewithfolder = remittance + FileNameAmended
			extractfolder = remittance
		
		logline = logwriter('i', 'Dnld:1.8f finalfilewithfolder: '+ finalfilewithfolder)
		dlfh.write(f"{logline}")

		#print('finalfilewithfolder', finalfilewithfolder)
		decoded = base64.b64decode(Filecontent)

		# v8d: Check free disk space before writing zip — avoids mid-write crash on full disk.
		free_mb = check_disk_space_mb(os.path.dirname(finalfilewithfolder))
		if free_mb < MIN_FREE_DISK_MB:
			logline = logwriter('c', f'Dnld:DISK-FULL Pre-write check failed for {finalfilewithfolder} — only {free_mb:.1f} MB free (minimum {MIN_FREE_DISK_MB} MB required)')
			dlfh.write(f"{logline}")
			print(f'  [DISK FULL] Only {free_mb:.1f} MB free — cannot write {FileNameAmended}. Free up disk space and re-run.')
			return ''

		try:
			with open(finalfilewithfolder, 'wb') as f:
				f.write(decoded)
			f.close()
		except OSError as ose:
			# v8d: Catch disk-full (errno 28) and other OS write errors on zip write.
			if ose.errno == errno.ENOSPC:
				logline = logwriter('c', f'Dnld:DISK-FULL OSError errno 28 writing zip {finalfilewithfolder} — disk is full')
				dlfh.write(f"{logline}")
				print(f'  [DISK FULL] OSError writing {FileNameAmended} — disk is full. Free up space and re-run.')
			else:
				logline = logwriter('c', f'Dnld:OSError [{ose.errno}] writing zip {finalfilewithfolder}: {ose}')
				dlfh.write(f"{logline}")
			raise   # re-raise so GetHistoryTxnFileDownload can catch and break the loop

		logline = logwriter('i', 'Decrypt:1.2z .zip Content written and downloaded as : ' + finalfile )
		dlfh.write(f"{logline}")
		print('zip file to extract: ', finalfilewithfolder+' to the folder: '+extractfolder)
		with zipfile.ZipFile(finalfilewithfolder, 'r') as zip_ref:
			zip_ref.extractall(extractfolder)
			print('extracted successfully!')
			zip_ref.close()
			os.remove(finalfilewithfolder)
			logline = logwriter('i', 'Dnld:1.8f after os.remove(finalfilewithfolder): '+ finalfilewithfolder)
			dlfh.write(f"{logline}")
		# v8f: Return sentinel 'ZIP_EXTRACTED' — zip is intentionally deleted after
		# extraction so os.path.exists() would always return False. Sentinel tells
		# GetHistoryTxnFileDownload this was a confirmed success, no file check needed.
		return 'ZIP_EXTRACTED'

def GetHistoryTxnFileDownload(xmlBody, transactionID):
	#print('transactionID - begin GetHistoryTxnFileDownload: ', transactionID)
	logline = logwriter('i', 'transactionID - begin GetHistoryTxnFileDownload: '+transactionID)
	dlfh.write(f"{logline}")

	# Get the current date and time
	now = datetime.now()
	# Format the date and time as a string 2024-08-25 13:20:45
	formatted_datetime = now.strftime("%Y-%m-%d-%H-%M-%S")
	#formatted_datetime = now.strftime("%Y-%m-%d")
	#print("trigger datetime", formatted_datetime)
	#7d Added facility part of the file name
	downloadedfileslog = 'downloadlog-'+facility+'-'+formatted_datetime+'.csv'
	logline = logwriter('i', 'HisDnld:1.1 HistoryTransaction details logged in to : ' + downloadedfileslog )
	dlfh.write(f"{logline}")
	with open(downloadedfileslog, 'w') as txnfileoutput:
		txnCSVRecHeader = 'FileID' + "," + 'FileName' + "," + 'SenderID' + "," + 'ReceiverID' + "," + 'TransactionDate' + "," + 'RecordCount' + "," + 'TransactionTimestamp' + "," + 'IsDownloaded'
		txnfileoutput.write(txnCSVRecHeader + '\n')
		
		nextFileNameloc = 1
		fileseqno = 0
		# v8c: counters for end-of-function run summary
		count_downloaded = 0
		count_skipped    = 0   # returned '' due to non-zero Shafafiya API result
		count_notfound   = 0   # returned a filename but file not on disk after download
		while nextFileNameloc > 0:
			#To get Transaction details
			fileseqno = fileseqno + 1
			#get FileID
			nextFileIDloc = xmlBody.find("FileID='", nextFileNameloc, )
			if nextFileIDloc <= 0: return
			nextFileNameloc = xmlBody.find("' FileName='", nextFileNameloc, )
			if nextFileNameloc <= 0: return
			FileID = xmlBody[nextFileIDloc+8:nextFileNameloc]
			#print('FileID:', FileID)
			#get FileName
			nextSenderIDloc = xmlBody.find("' SenderID='", nextFileNameloc, )
			#print (FileNameloc, SenderIDloc)
			FileName = xmlBody[nextFileNameloc+12:nextSenderIDloc]
			#print('FileName:', FileName)

			#get SenderID
			nextRecvrIDloc = xmlBody.find("' ReceiverID='", nextFileNameloc, )
			SenderID = xmlBody[nextSenderIDloc+12:nextRecvrIDloc]
			#print('SenderID:', SenderID)

			#get ReceiverID
			nextTransactionDateloc = xmlBody.find("' TransactionDate='", nextFileNameloc, )
			ReceiverID = xmlBody[nextRecvrIDloc+14:nextTransactionDateloc]
			#print('ReceiverID:', ReceiverID)

			#get TransactionDate
			nextRecordCountloc = xmlBody.find("' RecordCount='", nextFileNameloc, )
			TransactionDate = xmlBody[nextTransactionDateloc+19:nextRecordCountloc]
			#print('TransactionDate:', TransactionDate)

			#get RecordCount
			nextTransactionTimestamploc = xmlBody.find("' TransactionTimestamp='", nextFileNameloc, )
			RecordCount = xmlBody[nextRecordCountloc+15:nextTransactionTimestamploc]
			#print('RecordCount:', RecordCount)

			#get TransactionTimestamp
			nextIsDownloadedloc = xmlBody.find("' IsDownloaded='", nextFileNameloc, )
			TransactionTimestamp = xmlBody[nextTransactionTimestamploc+24:nextIsDownloadedloc]
			#print('TransactionTimestamp:', TransactionTimestamp)

			#get IsDownloaded
			#print("nextIsDownloadedloc location:", nextIsDownloadedloc)
			#IsDownloaded = xmlBody[nextIsDownloadedloc:nextIsDownloadedloc+5]
			IsDownloaded = xmlBody[nextIsDownloadedloc+16:nextIsDownloadedloc+16+4]
			#print('IsDownloaded:', IsDownloaded)
			txnCSVRecHeader = FileID + "," + FileName + "," + SenderID + "," + ReceiverID + "," + TransactionDate + "," + RecordCount + "," + TransactionTimestamp + "," + IsDownloaded
			txnfileoutput.write(txnCSVRecHeader + '\n')
			#print("**** userid ***", userid)
			logline = logwriter('i', 'HisDnld:1.2 HistoryTransaction details being logged in to : ' + downloadedfileslog )
			dlfh.write(f"{logline}")
			logline = logwriter('i', 'HisDnld:1.3 Before Call : DownloadHistoryTxnFile(FileID) for the FileID: '+FileID)
			dlfh.write(f"{logline}")
			#print('transactionID - before call DownloadHistoryTxnFile: ', transactionID)

			# v8d: Wrap the download call — if a disk-full OSError is re-raised from
			# DownloadHistoryTxnFile (or from remove_attachments_from_file inside it),
			# catch it here, log CRITICAL, and break the FileID loop cleanly so the
			# run summary is still printed and the process exits without a raw traceback.
			try:
				downloadedFilename = DownloadHistoryTxnFile(FileID, fileseqno, transactionID)
			except OSError as ose:
				if ose.errno == errno.ENOSPC:
					logline = logwriter('c', f'HisDnld:DISK-FULL OSError errno 28 for FileID {FileID} — stopping FileID loop, disk is full')
					dlfh.write(f"{logline}")
					print(f'\n  *** DISK FULL *** OSError [Errno 28] — No space left on device.')
					print(f'  Stopped after {count_downloaded} files downloaded. Free up disk space and re-run.')
					print(f'  Already downloaded files are safe — idempotent re-run will skip existing files.')
					break   # exit the while loop; summary will still print below
				else:
					logline = logwriter('c', f'HisDnld:OSError [{ose.errno}] for FileID {FileID}: {ose}')
					dlfh.write(f"{logline}")
					raise   # unexpected OS error — re-raise for main() to catch

			#print('FileID', FileID)
			#print('downloadedFilename: ', downloadedFilename)
			logline = logwriter('i', 'HisDnld:1.4 Downoladed file for the FileID: '+FileID+ 'is: '+downloadedFilename)
			dlfh.write(f"{logline}")

			# v8f: Three outcome branches:
			#   ''             — API returned non-zero result (e.g. -6), file skipped cleanly
			#   'ZIP_EXTRACTED'— zip downloaded, extracted, .zip removed by design — confirmed success
			#   full path      — XML written to claims/remittance folder — verify with os.path.exists()
			if downloadedFilename == '':
				count_skipped += 1
				logline = logwriter('w', f'HisDnld:1.5s FileID {FileID} skipped (API error) — no file written')
				dlfh.write(f"{logline}")
			elif downloadedFilename == 'ZIP_EXTRACTED':
				count_downloaded += 1
				logline = logwriter('i', f'HisDnld:1.5z FileID {FileID} ZIP downloaded and extracted successfully')
				dlfh.write(f"{logline}")
			elif os.path.exists(downloadedFilename):
				count_downloaded += 1
				logline = logwriter('i', 'HisDnld:1.5 File: '+ downloadedFilename +' Downloaded Successfully')
				dlfh.write(f"{logline}")
				# ClaimSync2 P2-T06: upload to Azure Blob (no-op unless CLAIMSSYNC_BLOB_UPLOAD=1)
				_ftype = 'claims' if transactionID == '2' else 'remittance'
				_blob_upload_file(downloadedFilename, _blob_ct, _ftype, facility)
			else:
				count_notfound += 1
				logline = logwriter('w', 'HisDnld:1.6 File NOT found on disk after download — please recheck: '+ downloadedFilename)
				dlfh.write(f"{logline}")

			nextFileNameloc = nextFileNameloc + 1
	txnfileoutput.close

	# v8e: Run remove_attachments_from_resubmissionfiles() ONCE here after all
	# FileIDs in this batch are processed — replaces the per-file call that was
	# inside DownloadHistoryTxnFile(). Only needed for claims (transactionID '2').
	# This is O(n) instead of O(n²) — scans the resubmission folder exactly once
	# per GetHistoryTxnFileDownload call regardless of how many files were downloaded.
	if transactionID == '2':
		logline = logwriter('i', 'HisDnld:1.7 Post-batch: remove_attachments_from_resubmissionfiles() — single call for entire batch')
		dlfh.write(f"{logline}")
		remove_attachments_from_resubmissionfiles(resubmission)

	# v8c: Print and log a run summary so it is clear what happened in each
	# GetHistoryTxnFileDownload call — especially useful after long historical runs.
	total_fileids = count_downloaded + count_skipped + count_notfound
	summary_msg = (f'HisDnld:SUMMARY FileIDs processed: {total_fileids} | '
				   f'Downloaded OK: {count_downloaded} | '
				   f'Skipped (API error): {count_skipped} | '
				   f'Not found on disk: {count_notfound}')
	print(f'\n  [SUMMARY] FileIDs: {total_fileids} | Downloaded: {count_downloaded} | '
		  f'API-skipped: {count_skipped} | Not-on-disk: {count_notfound}')
	logline = logwriter('i', summary_msg)
	dlfh.write(f"{logline}")

	return txnCSVRec

def FindnMoveResubmisison(claimfile, resubfile):
#	"""Reads all files in the specified folder."""
#	for filename in os.listdir(source):
#	file_path = os.path.join(source, filename)
	file_path = claimfile
	if os.path.isfile(file_path):
		with open(file_path, 'r') as file:
			filecontent = file.read()
			match = re.search('<Resubmission>', filecontent)
			file.close()
			#time.sleep(10)
			if match:
				shutil.copy(file_path, resubfile)
				#print('File: ', file_path, 'Contains <Resubmission>')
				logline = logwriter('i', 'Resub:1.1 File: '+file_path+'Contains <Resubmission>')
				dlfh.write(f"{logline}")
				try:
					with open(file_path, 'r') as f:
						# Try to open the file in read mode
						os.remove(file_path)
				except PermissionError:
				# If we get a PermissionError, the file is likely still open
					file.close()
					os.remove(file_path)
					#print('Unable to Delete: ', file_path)
			else:
				#print('File: ', file_path, 'Not Contains <Resubmission>')
				logline = logwriter('i', 'File: '+file_path+'Not Contains <Resubmission>')
				dlfh.write(f"{logline}")

def build_and_execute_search_request(
		interval_from, interval_to, interval_idx, claim_remit,
		direction, callerLicense, ePartner, transactionID, transactionStatus,
		transactionFileName, minRecordCount, maxRecordCount):
	"""
	Builds a Shafafiya SearchTransactions SOAP request XML for a specific
	time window, fires curl immediately, and saves the response file.

	Naming convention (per interval):
	  Request : search_history_request_{facility}_{claim_remit}_{interval_idx}.xml
	  Response: search_history_response_{facility}_{claim_remit}_{interval_idx}.xml

	Args:
		interval_from       (str): Window start  e.g. '18/02/2026 00:00:00'
		interval_to         (str): Window end    e.g. '18/02/2026 02:00:00'
		interval_idx        (int): Zero-based sequence number for this window
		claim_remit         (str): 'claim' or 'remit'
		direction           (str): API direction field (1=claim, 2=remit)
		callerLicense       (str): Caller licence value from ini
		ePartner            (str): ePartner value from ini
		transactionStatus   (str): Transaction status filter from ini
		transactionFileName (str): Transaction filename filter from ini
		minRecordCount      (str): Min record count from ini
		maxRecordCount      (str): Max record count from ini

	Returns:
		str | None: Response filename on success, None on curl failure.
	"""
	req_fname  = systemfolder + f"search_history_request_{facility}_{claim_remit}_{interval_idx}.xml"
	resp_fname = systemfolder + f"search_history_response_{facility}_{claim_remit}_{interval_idx}.xml"

	logline = logwriter('i', f'His:Intv[{interval_idx}] Request: {req_fname} | {interval_from} to {interval_to}')
	dlfh.write(f"{logline}")

	# --- Build SOAP request XML ---
	with open(req_fname, "w") as hrf:
		hrf.write('<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:v2="https://www.shafafiya.org/v2/">\n')
		hrf.write("   <soapenv:Header/>\n")
		hrf.write("   <soapenv:Body>\n")
		hrf.write("     <v2:SearchTransactions>\n")
		hrf.write("      <!--Optional:-->\n")
		hrf.write("        <v2:login>"          + userid.strip('"')        + "</v2:login>\n")
		hrf.write("      <!--Optional:-->\n")
		hrf.write("        <v2:pwd>"            + password.strip('"')      + "</v2:pwd>\n")
		hrf.write("        <v2:direction>"      + str(direction)           + "</v2:direction>\n")
		hrf.write("      <!--Optional:-->\n")
		hrf.write("        <v2:callerLicense>"  + callerLicense.strip('"') + "</v2:callerLicense>\n")
		hrf.write("      <!--Optional:-->\n")
		hrf.write("        <v2:ePartner>"       + ePartner                 + "</v2:ePartner>\n")
		hrf.write("        <v2:transactionID>"  + str(transactionID)       + "</v2:transactionID>\n")
		hrf.write("        <v2:transactionStatus>" + str(transactionStatus)+ "</v2:transactionStatus>\n")
		hrf.write("      <!--Optional:-->\n")
		hrf.write("        <v2:transactionFileName>" + transactionFileName  + "</v2:transactionFileName>\n")
		hrf.write("      <!--Optional:-->\n")
		hrf.write("        <v2:transactionFromDate>" + interval_from        + "</v2:transactionFromDate>\n")
		hrf.write("      <!--Optional:-->\n")
		hrf.write("        <v2:transactionToDate>"   + interval_to          + "</v2:transactionToDate>\n")
		hrf.write("        <v2:minRecordCount>"   + str(minRecordCount)    + "</v2:minRecordCount>\n")
		hrf.write("        <v2:maxRecordCount>"   + str(maxRecordCount)    + "</v2:maxRecordCount>\n")
		hrf.write("     </v2:SearchTransactions>\n")
		hrf.write("  </soapenv:Body>\n")
		hrf.write("</soapenv:Envelope>")

	logline = logwriter('i', f'His:Intv[{interval_idx}] Request XML created: {req_fname}')
	dlfh.write(f"{logline}")

	# --- Execute HTTP POST via httpx (v8h: replaces curl subprocess) ---
	# soap_search_transactions() is synchronous/blocking — eliminates shell=True,
	# subprocess.Popen, and process.communicate(). Returns resp_fname on success,
	# None on failure (mirrors the previous curl return contract exactly).
	return soap_search_transactions(req_fname, resp_fname, interval_idx, logwriter, dlfh)


def mainsub(downloadtype, active, claim_remit):

	if downloadtype == 'n' and active == 'y':
		#print("To Download New Transaction Files")
		logline = logwriter('i', "Pre:1.13 downloadtype == 'n' and active == 'y' To Download New Transaction Files")
		dlfh.write(f"{logline}")
	elif (downloadtype == 'h' or downloadtype == 'hff') and active == 'y':
		#print("To Download New Txn files 5")
		#print("To Download History Transaction Files")

		logline = logwriter('i', "Pre:1.14 downloadtype == 'h' and active == 'y' To Download History Transaction Files")
		dlfh.write(f"{logline}")
		#print('transactionID', transactionID)
		#Step 1.1 : format SearchTransactions Response File
		logline = logwriter('i', 'His:1.5  : format SearchTransactions Response File')
		dlfh.write(f"{logline}")
		direction = config['client-config-'+str(currentsetup)]['direction']
		callerLicense=config['client-config-'+str(currentsetup)]['callerLicense']
		ePartner = config['client-config-'+str(currentsetup)]['ePartner']
		transactionID = config['client-config-'+str(currentsetup)]['transactionID']
		#print('transactionID - mainsub - once fetch', transactionID)
		transactionStatus = config['client-config-'+str(currentsetup)]['transactionStatus']
		defaultsearch = config['client-config-'+str(currentsetup)]['defaultsearch']
		transactionFileName = config['client-config-'+str(currentsetup)]['transactionFileName']
		#transactionFromDate = config['client-config-'+str(currentsetup)]['transactionFromDate']
		#transactionToDate = config['client-config-'+str(currentsetup)]['transactionToDate']
		minRecordCount = config['client-config-'+str(currentsetup)]['minRecordCount']
		maxRecordCount = config['client-config-'+str(currentsetup)]['maxRecordCount']

		if claim_remit == 'claim':
			direction='1'
			transactionID='2'
		elif claim_remit == 'remit':
			direction='2'
			transactionID='8'

		logline = logwriter('i', 'His:1.6 searchhistoryparams has been fetched for further processing')
		dlfh.write(f"{logline}")

		logline = logwriter('i', 'His:1.7 : format SearchTransactions Response File')
		dlfh.write(f"{logline}")

		#print("To Download New Txn files 6")
		#hrfname = systemfolder.strip('"') + "search_history_request.xml"
		#hresponsefname = systemfolder.strip('"') + "search_history_response.xml"
		hrfname = systemfolder + "search_history_request_"+facility+"_"+claim_remit+".xml"
		hresponsefname = systemfolder + "search_history_response_"+facility+"_"+claim_remit+".xml"

	#Option 1: downloadTxnFilesv7 n
	if downloadtype == "n":
		#print("To Download New Txn files")
		logline = logwriter('i', 'New:1.1 Option : n : To Download New Txn files')
		dlfh.write(f"{logline}")
	#Option 2: downloadTxnFilesv7 h
	elif downloadtype == "h":
		#print("To Download History Txn files")
		logline = logwriter('i', 'His:1.1 Option : h : To Download History Txn files')
		dlfh.write(f"{logline}")
	#Option 3: downloadTxnFilesv7 hf
	elif downloadtype == "hf":
		# v8b: In interval mode the h step already executed all curl calls directly.
		# downloadhistfileids.bat now contains only a comment marker.
		# We still run it so the legacy call sequence (h → hf → hff) is unchanged,
		# but it is effectively a no-op.
		logline = logwriter('i', 'His:1.2 Option : hf : v8b interval mode — curl already done in h phase, skipping bat execution')
		dlfh.write(f"{logline}")

		with open("downloadhistfileids.bat", "r") as batfile:
			curlcommand = batfile.read()
			logline = logwriter('i', 'His:1.3 downloadhistfileids.bat contents: '+curlcommand.strip())
			dlfh.write(f"{logline}")

		if curlcommand.strip().startswith("rem v8b"):
			logline = logwriter('i', 'His:1.4 v8b marker detected — no curl execution needed')
			dlfh.write(f"{logline}")
		else:
			# Fallback: if somehow an old-style bat file is present, execute it safely
			logline = logwriter('w', 'His:1.4a Legacy bat file detected — executing curl for backward compatibility')
			dlfh.write(f"{logline}")
			process = subprocess.Popen(curlcommand, shell=True, stdout=subprocess.PIPE, text=True)
			output, error = process.communicate()
			logline = logwriter('i', 'His:1.5 Legacy bat file curl processed')
			dlfh.write(f"{logline}")
		return
		#print(output)
	#Option 4: downloadTxnFilesv7 hff
	elif downloadtype == "hff":
		#v8b: process ALL interval response files for this facility+claim_remit
		logline = logwriter('i', 'HisDtl:1.1 To Download Files using ALL interval Response Files')
		dlfh.write(f"{logline}")
		pattern = systemfolder + f"search_history_response_{facility}_{claim_remit}_*.xml"
		response_files = sorted(glob.glob(pattern))
		logline = logwriter('i', f'HisDtl:1.2 Found {len(response_files)} response file(s) matching: {pattern}')
		dlfh.write(f"{logline}")
		if not response_files:
			logline = logwriter('w', f'HisDtl:1.2a No response files found for pattern: {pattern}')
			dlfh.write(f"{logline}")
		for resp_file in response_files:
			logline = logwriter('i', f'HisDtl:1.3 Processing response file: {resp_file}')
			dlfh.write(f"{logline}")
			with open(resp_file, "r") as fileidfile:
				fileidchunks = fileidfile.read().replace("\n", " ")
			logline = logwriter('i', f'HisDtl:1.4 Calling GetHistoryTxnFileDownload for: {resp_file}')
			dlfh.write(f"{logline}")
			GetHistoryTxnFileDownload(fileidchunks, transactionID)
		return
	else:
		print("Input parameter should be either n (new txn files) or h (history files)")
		logline = logwriter('i', 'Pre:1.12 Input parameter should be either n (new txn files) or h (history files) ')
		dlfh.write(f"{logline}")
		return
		
	# -----------------------------------------------------------------------
	# v8b: Determine overall from/to date range
	# -----------------------------------------------------------------------
	SHAFAFIYA_DATE_FMT = '%d/%m/%Y %H:%M:%S'
	INTERVAL_HOURS = 2          # split window size — keeps results under 1000 cap

	if defaultsearch.lower() == 'y':
		# Default search: yesterday 00:00:00 → today 00:00:00  (24-hr window)
		now = datetime.now()
		current_date_time  = now.strftime(SHAFAFIYA_DATE_FMT)
		yesterday          = arrow.now().shift(days=-1).date()
		previous_date_time = yesterday.strftime('%d/%m/%Y') + ' 00:00:00'
		transactionToDate   = current_date_time
		transactionFromDate = previous_date_time
		logline = logwriter('i', 'His:1.8 defaultsearch=y | range: '+transactionFromDate+' to '+transactionToDate)
		dlfh.write(f"{logline}")
	else:
		transactionFromDate = config['client-config-'+str(currentsetup)]['transactionFromDate']
		transactionToDate   = config['client-config-'+str(currentsetup)]['transactionToDate']
		logline = logwriter('i', 'His:1.9  transactionFromDate: '+transactionFromDate)
		dlfh.write(f"{logline}")
		logline = logwriter('i', 'His:1.10 transactionToDate: '+transactionToDate)
		dlfh.write(f"{logline}")

	# -----------------------------------------------------------------------
	# v8b: Build 2-hour interval windows and call API for each window.
	#      This avoids the silent 1000-file truncation from the Shafafiya API.
	#      Each window gets its own numbered request/response XML pair.
	#      Curl is executed immediately for each window (no .bat intermediary).
	#      The hf step is now a no-op; hff globs all response files.
	# -----------------------------------------------------------------------
	try:
		range_start = datetime.strptime(transactionFromDate.strip(), SHAFAFIYA_DATE_FMT)
		range_end   = datetime.strptime(transactionToDate.strip(),   SHAFAFIYA_DATE_FMT)
	except ValueError as e:
		logline = logwriter('e', 'His:1.11a Date parse error: '+str(e)+' | from='+transactionFromDate+' to='+transactionToDate)
		dlfh.write(f"{logline}")
		return

	if range_end <= range_start:
		logline = logwriter('w', 'His:1.11b transactionToDate is not after transactionFromDate — nothing to process')
		dlfh.write(f"{logline}")
		return

	# Build list of (window_start, window_end) pairs
	intervals = []
	window_start = range_start
	while window_start < range_end:
		window_end = min(window_start + timedelta(hours=INTERVAL_HOURS), range_end)
		intervals.append((window_start, window_end))
		window_start = window_end

	total_intervals = len(intervals)
	logline = logwriter('i', f'His:1.11 Total {INTERVAL_HOURS}-hr intervals to process: {total_intervals} | {transactionFromDate} to {transactionToDate}')
	dlfh.write(f"{logline}")
	print(f"  [{facility}][{claim_remit}] Splitting into {total_intervals} x {INTERVAL_HOURS}-hr API calls...")

	successful = 0
	failed     = 0
	for idx, (wstart, wend) in enumerate(intervals):
		wstart_str = wstart.strftime(SHAFAFIYA_DATE_FMT)
		wend_str   = wend.strftime(SHAFAFIYA_DATE_FMT)
		print(f"  [{facility}][{claim_remit}] Interval {idx+1}/{total_intervals}: {wstart_str} -> {wend_str}")
		result = build_and_execute_search_request(
			wstart_str, wend_str, idx, claim_remit,
			direction, callerLicense, ePartner, transactionID, transactionStatus,
			transactionFileName, minRecordCount, maxRecordCount)
		if result:
			successful += 1
		else:
			failed += 1
			logline = logwriter('w', f'His:Intv[{idx}] Interval FAILED, continuing with next interval')
			dlfh.write(f"{logline}")
		# sleep(3) retained intentionally — httpx is synchronous/blocking, so this is
		# NOT a correctness guard against async races.
		# It is a courtesy rate-limit pause between API calls to the Shafafiya
		# endpoint. Kept at 3s as originally set in v8b — do not reduce.
		time.sleep(3)

	logline = logwriter('i', f'His:1.15 Interval loop complete: {successful} succeeded, {failed} failed out of {total_intervals} total')
	dlfh.write(f"{logline}")
	print(f"  [{facility}][{claim_remit}] All {total_intervals} intervals done: {successful} OK, {failed} failed")
	# Write a harmless marker so the legacy hf step (which reads downloadhistfileids.bat)
	# does not re-execute an old curl command from a previous run.
	with open("downloadhistfileids.bat", "w") as dhf:
		dhf.write("rem v8b: interval mode active — curl already executed during h phase\n")

def main():
    # ── ClaimSync2 Cloud Engine — BAU download flow only ──────────────────
    # Config source : Azure PostgreSQL (DBConfigProvider) +
    #                 Azure Key Vault  (KeyVaultCredentialProvider)
    # No .ini file, no onboarding, no license checks, no host-lock.
    # Invocation    : python ClaimSync2.py h
    # ──────────────────────────────────────────────────────────────────────

    global fileseqno, userid, password, claims, resubmission, remittance
    global dlfh, tempfolder, systemfolder, currentsetup, config, transactionID, facility
    global hrfname, hresponsefname
    global MIN_FREE_DISK_MB
    MIN_FREE_DISK_MB = 50

    # ── Log file ───────────────────────────────────────────────────────────
    now = datetime.now()
    formatted_datetime = now.strftime("%Y-%m-%d-%H-%M-%S")
    log_dir = os.environ.get('CLAIMSSYNC_TEMP_DIR', '/tmp/claimssync/')
    os.makedirs(log_dir, exist_ok=True)
    downloadlogfile = os.path.join(log_dir, 'downloadlog-' + formatted_datetime + '.log')
    dlfh = open(downloadlogfile, 'a')
    logline = logwriter('i', 'Pre:1.1 log file: ' + downloadlogfile + ' Opened Successfully')
    dlfh.write(f"{logline}")

    # ── Validate parameter — cloud engine only accepts h ───────────────────
    if len(sys.argv) < 2 or sys.argv[1].lower() != 'h':
        print("[ClaimSync2] Usage: python ClaimSync2.py h")
        logline = logwriter('w', 'Pre:1.2 Missing or invalid parameter — expected h')
        dlfh.write(f"{logline}")
        dlfh.close()
        return

    # ── Cloud config: DB + Key Vault ───────────────────────────────────────
    _tenant = os.environ.get('CLAIMSSYNC_TENANT', '').strip()
    _kv_uri = os.environ.get('CLAIMSSYNC_KV_URI', '').strip()

    print(f"[ClaimSync2] tenant={_tenant or '(not set)'} | kv={_kv_uri or '(not set)'}")
    logline = logwriter('i', f'Pre:1.3 tenant={_tenant or "(not set)"} kv_uri={_kv_uri or "(not set)"}')
    dlfh.write(f"{logline}")

    if not _tenant or not _kv_uri:
        print("\033[31m[ClaimSync2] FATAL: CLAIMSSYNC_TENANT or CLAIMSSYNC_KV_URI not set.\033[0m")
        logline = logwriter('c', 'Crit:1.1 CLAIMSSYNC_TENANT or CLAIMSSYNC_KV_URI env var missing — cannot start')
        dlfh.write(f"{logline}")
        dlfh.close()
        return

    try:
        from db_config_provider import DBConfigProvider
        from kv_credential_provider import KeyVaultCredentialProvider

        print(f"[ClaimSync2] ConfigProvider: DBConfigProvider | vault={_kv_uri}")
        logline = logwriter('i', f'Pre:1.4 ConfigProvider: DBConfigProvider vault={_kv_uri}')
        dlfh.write(f"{logline}")

        _kv_provider = KeyVaultCredentialProvider(vault_uri=_kv_uri)
        provider     = DBConfigProvider(
                           tenant_short_code=_tenant,
                           credential_provider=_kv_provider,
                       )
        config = provider.get_main_config()

        logline = logwriter('i', 'Pre:1.5 DB+KV config loaded successfully')
        dlfh.write(f"{logline}")

    except Exception as exc:
        print(f"\033[31m[ClaimSync2] FATAL: Config load failed — {exc}\033[0m")
        logline = logwriter('c', f'Crit:1.2 Config load failed: {exc}')
        dlfh.write(f"{logline}")
        dlfh.close()
        return

    # ── Facility loop setup ────────────────────────────────────────────────
    noofsetup    = int(config['shafaapi-main']['noofsetup'])
    tempfolder   = config['shafaapi-main']['tempfolder'].strip('"')
    systemfolder = tempfolder  # cloud: no separate systemfolder — same as tempfolder

    logline = logwriter('i', f'Pre:1.6 noofsetup={noofsetup} tempfolder={tempfolder} systemfolder={systemfolder}')
    dlfh.write(f"{logline}")

    # ── Clean temp folder ──────────────────────────────────────────────────
    try:
        os.makedirs(tempfolder, exist_ok=True)
        for file in os.listdir(tempfolder):
            if Path(file).suffix.lower() == ".xml" and \
               not Path(file).name.startswith("search_history_"):
                os.remove(os.path.join(tempfolder, file))
                logline = logwriter('i', 'Pre:1.7a ' + file + ' deleted from temp')
                dlfh.write(f"{logline}")
    except Exception as exc:
        logline = logwriter('w', f'Pre:1.7b temp folder cleanup warning: {exc}')
        dlfh.write(f"{logline}")

    # ── BAU facility download loop ─────────────────────────────────────────
    try:
        for currentsetup in range(1, noofsetup + 1):
            section      = f'client-config-{currentsetup}'
            userid       = config[section]['userid']
            password     = config[section]['password']
            facility     = config[section]['facility']
            claims       = config[section]['claims']
            resubmission = config[section]['resubmission']
            remittance   = config[section]['remittance']

            logline = logwriter('i', f'Pre:1.10 Facility {facility} config loaded from DB+KV')
            dlfh.write(f"{logline}")

            # ── v3.4: Ensure all output folders exist before download ──────
            # resubmission folder MUST exist before hff-claim runs
            # remove_attachments_from_resubmissionfiles() crashes if missing
            for _folder, _label in [
                (claims,       'claims'),
                (resubmission, 'resubmission'),
                (remittance,   'remittance'),
            ]:
                try:
                    os.makedirs(_folder, exist_ok=True)
                    logline = logwriter('i', f'Pre:1.10a Created/verified folder: {_folder}')
                    dlfh.write(f"{logline}")
                except Exception as _fe:
                    logline = logwriter('w', f'Pre:1.10b Folder create warning [{_label}]: {_fe}')
                    dlfh.write(f"{logline}")

            # ── Claims: search → list → download ──────────────────────────
            print(f"[ClaimSync2] facility={facility} setup={currentsetup} (h-claim)")
            logline = logwriter('i', f'Processing Setup: (h-claim): {currentsetup} facility={facility}')
            dlfh.write(f"{logline}")
            mainsub('h',   'y', 'claim')

            print(f"[ClaimSync2] facility={facility} setup={currentsetup} (hf-claim)")
            logline = logwriter('i', f'Processing Setup: (hf-claim): {currentsetup}')
            dlfh.write(f"{logline}")
            mainsub('hf',  'y', 'claim')

            print(f"[ClaimSync2] facility={facility} setup={currentsetup} (hff-claim)")
            logline = logwriter('i', f'Processing Setup: (hff-claim): {currentsetup}')
            dlfh.write(f"{logline}")
            mainsub('hff', 'y', 'claim')

            # ── Remittance: search → list → download ───────────────────────
            print(f"[ClaimSync2] facility={facility} setup={currentsetup} (h-remit)")
            logline = logwriter('i', f'Processing Setup: (h-remit): {currentsetup}')
            dlfh.write(f"{logline}")
            mainsub('h',   'y', 'remit')

            print(f"[ClaimSync2] facility={facility} setup={currentsetup} (hf-remit)")
            logline = logwriter('i', f'Processing Setup: (hf-remit): {currentsetup}')
            dlfh.write(f"{logline}")
            mainsub('hf',  'y', 'remit')

            print(f"[ClaimSync2] facility={facility} setup={currentsetup} (hff-remit)")
            logline = logwriter('i', f'Processing Setup: (hff-remit): {currentsetup}')
            dlfh.write(f"{logline}")
            mainsub('hff', 'y', 'remit')

    except OSError as ose:
        if ose.errno == errno.ENOSPC:
            logline = logwriter('c', 'Main:DISK-FULL OSError errno 28 — disk full. Exiting cleanly.')
            dlfh.write(f"{logline}")
            print("\033[31m*** DISK FULL — No space left on device ***\033[0m")
            print('Free up disk space and re-run. Already downloaded files are safe.')
        else:
            logline = logwriter('c', f'Main:OSError [{ose.errno}]: {ose}')
            dlfh.write(f"{logline}")
            raise

    logline = logwriter('i', 'Main:END BAU download run completed')
    dlfh.write(f"{logline}")
    dlfh.close()
    print("[ClaimSync2] BAU run complete.")


if __name__ == "__main__":
    main()
