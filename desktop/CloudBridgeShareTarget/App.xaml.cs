
using Microsoft.UI.Xaml;
using Microsoft.Windows.AppLifecycle;

using System;
using System.Diagnostics;
using System.IO;
using System.Threading.Tasks;

using Windows.ApplicationModel.Activation;
using Windows.ApplicationModel.DataTransfer;
using Windows.ApplicationModel.DataTransfer.ShareTarget;
using Windows.Storage;
using Windows.System;

namespace CloudBridgeShareTarget
{
    public partial class App : Application
    {
        private Window? _window;

        private const long MaxFileSize = 50L * 1024 * 1024;

        public App()
        {
            InitializeComponent();

            Debug.WriteLine(
                "CLOUDBRIDGE: App constructor executed."
            );

            AppInstance.GetCurrent().Activated += OnActivated;
        }

        protected override void OnLaunched(
            Microsoft.UI.Xaml.LaunchActivatedEventArgs args)
        {
            Debug.WriteLine(
                "CLOUDBRIDGE: OnLaunched executed."
            );

            var activation = AppInstance.GetCurrent()
                .GetActivatedEventArgs();

            Debug.WriteLine(
                $"CLOUDBRIDGE: Activation kind = {activation.Kind}"
            );

            // Share Target activation must not create a blank window.
            if (
                activation.Kind == ExtendedActivationKind.ShareTarget &&
                activation.Data is ShareTargetActivatedEventArgs shareArgs
            )
            {
                Debug.WriteLine(
                    "CLOUDBRIDGE: Share Target activation detected. " +
                    "Skipping MainWindow creation."
                );

                _ = HandleShareAsync(shareArgs);
                return;
            }

            // Create the window only for normal application launches.
            Debug.WriteLine(
                "CLOUDBRIDGE: Normal launch. Creating MainWindow."
            );

            _window = new MainWindow();
            _window.Activate();
        }

        private void OnActivated(
            object? sender,
            AppActivationArguments args)
        {
            Debug.WriteLine(
                $"CLOUDBRIDGE: OnActivated kind = {args.Kind}"
            );

            if (
                args.Kind == ExtendedActivationKind.ShareTarget &&
                args.Data is ShareTargetActivatedEventArgs shareArgs
            )
            {
                Debug.WriteLine(
                    "CLOUDBRIDGE: Share Target event received."
                );

                _ = HandleShareAsync(shareArgs);
            }
        }

        private async Task HandleShareAsync(
            ShareTargetActivatedEventArgs args)
        {
            Debug.WriteLine(
                "CLOUDBRIDGE: HandleShareAsync started."
            );

            ShareOperation operation = args.ShareOperation;

            string? destinationPath = null;

            try
            {
                operation.ReportStarted();

                Debug.WriteLine(
                    "CLOUDBRIDGE: Share operation started."
                );

                // Check whether Windows supplied files.
                if (!operation.Data.Contains(
                    StandardDataFormats.StorageItems))
                {
                    operation.ReportError(
                        "CloudBridge currently supports shared files only."
                    );

                    return;
                }

                // Retrieve shared items.
                var items = await operation.Data.GetStorageItemsAsync();

                Debug.WriteLine(
                    $"CLOUDBRIDGE: Received {items.Count} item(s)."
                );

                if (items.Count == 0)
                {
                    operation.ReportError(
                        "No files were received."
                    );

                    return;
                }

                // One file per sharing operation.
                if (items.Count > 1)
                {
                    operation.ReportError(
                        "Please share one file at a time."
                    );

                    return;
                }

                if (items[0] is not StorageFile file)
                {
                    operation.ReportError(
                        "The shared item is not a supported file."
                    );

                    return;
                }

                Debug.WriteLine(
                    $"CLOUDBRIDGE: File received = {file.Name}"
                );

                // Check file size.
                var properties = await file.GetBasicPropertiesAsync();

                Debug.WriteLine(
                    $"CLOUDBRIDGE: File size = {properties.Size} bytes."
                );

                if (properties.Size == 0)
                {
                    operation.ReportError(
                        "The selected file is empty."
                    );

                    return;
                }

                if (properties.Size > MaxFileSize)
                {
                    operation.ReportError(
                        "The maximum supported file size is 50 MB."
                    );

                    return;
                }

                // Create temporary storage.
                string folderPath = Path.Combine(
                    Path.GetTempPath(),
                    "CloudBridgeShareTarget"
                );

                Directory.CreateDirectory(folderPath);

                // Generate a unique filename.
                string safeFileName = Path.GetFileName(file.Name);

                destinationPath = Path.Combine(
                    folderPath,
                    $"{Guid.NewGuid():N}_{safeFileName}"
                );

                Debug.WriteLine(
                    "CLOUDBRIDGE: Copying shared file..."
                );

                // Copy the shared file.
                using (
                    var source = await file.OpenStreamForReadAsync()
                )
                using (
                    var destination = new FileStream(
                        destinationPath,
                        FileMode.CreateNew,
                        FileAccess.Write,
                        FileShare.None
                    )
                )
                {
                    await source.CopyToAsync(destination);
                }

                Debug.WriteLine(
                    $"CLOUDBRIDGE: Temporary file = {destinationPath}"
                );

                // Verify copied file.
                if (!File.Exists(destinationPath))
                {
                    throw new FileNotFoundException(
                        "The temporary shared file was not created."
                    );
                }

                // Build Electron protocol URL.
                string shareUri =
                    "cloudbridge://share?file=" +
                    Uri.EscapeDataString(destinationPath);

                Debug.WriteLine(
                    $"CLOUDBRIDGE: Launching URI = {shareUri}"
                );

                // Launch existing Electron application.
                bool launched = await Launcher.LaunchUriAsync(
                    new Uri(shareUri)
                );

                Debug.WriteLine(
                    $"CLOUDBRIDGE: Electron launch result = {launched}"
                );

                if (!launched)
                {
                    operation.ReportError(
                        "Could not open CloudBridge. " +
                        "Please check that the desktop app is installed " +
                        "and its cloudbridge protocol is registered."
                    );

                    return;
                }

                Debug.WriteLine(
                    "CLOUDBRIDGE: Share operation completed successfully."
                );

                operation.ReportCompleted();
            }
            catch (Exception ex)
            {
                Debug.WriteLine(
                    "CLOUDBRIDGE ERROR: " + ex
                );

                operation.ReportError(
                    $"CloudBridge could not receive the file: {ex.Message}"
                );
            }
        }
    }
}
